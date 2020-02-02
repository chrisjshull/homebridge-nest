/**
 * Created by Adrian Cable on 7/16/19.
 */

const Promise = require('bluebird');
const debounce = require('lodash.debounce');
const rp = require('request-promise');
const Prompt = require('promise-prompt');

'use strict';

module.exports = Connection;

// Amount of time to run the fan when accessory is turned on, unless overridden in config.json
const DEFAULT_FAN_DURATION_MINUTES = 15;

// Delay after authentication fail before retrying
const API_AUTH_FAIL_RETRY_DELAY_SECONDS = 15;

// Max number of authentication attempts
const API_AUTH_FAIL_MAX_CALLS = 20;

// Interval between Nest subscribe requests
const API_SUBSCRIBE_DELAY_SECONDS = 0.1;

// Nest property updates are combined together if less than this time apart, to reduce network traffic
const API_PUSH_DEBOUNCE_SECONDS = 2;

// Maximum time to combine property updates before issuing API call
const API_PUSH_DEBOUNCE_MAXWAIT_SECONDS = 8;

// Maximum time to merge pending changes into HomeKit data, to allow Nest API to catch up
const API_MERGE_PENDING_MAX_SECONDS = 8;

// Delay after thermostat mode change before sending any other requests
const API_MODE_CHANGE_DELAY_SECONDS = 7;

// Timeout subscribe API calls after this number of seconds
const API_SUBSCRIBE_TIMEOUT_SECONDS = 120;

// Timeout other API calls after this number of seconds
const API_TIMEOUT_SECONDS = 40;

// We want to look like a browser
const USER_AGENT_STRING = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.100 Safari/537.36';

// Endpoint URLs
const URL_NEST_AUTH = 'https://home.nest.com/session';
const URL_NEST_VERIFY_PIN = 'https://home.nest.com/api/0.1/2fa/verify_pin';
const ENDPOINT_PUT = '/v5/put';
const ENDPOINT_SUBSCRIBE = '/v5/subscribe';

function Connection(config, log, verbose) {
    this.config = config;
    this.token = '';
    this.objectList = { objects: [] };
    this.currentState = {};
    this.lastModeChangeTime = null;
    this.modeChangeTimer = null;
    this.mergeEndTimer = null;
    this.updateHomeKit = null;
    this.failedAuthAPICalls = 0;
    this.failedPushAPICalls = 0;

    this.log = function(...info) {
        log.info(...info);
    };
    this.debug = function(...info) {
        log.debug(...info);
    };
    this.verbose = function(...info) {
        if (verbose) {
            log.debug(...info);
        }
    };
    this.error = function(...info) {
        log.error(...info);
    };
}

Connection.prototype.pendingUpdates = [];
Connection.prototype.mergeUpdates = [];
Connection.prototype.currentData = {};
Connection.prototype.connected = false;

Connection.prototype.auth = function() {
    return new Promise(resolve => {
        Promise.coroutine(function* () {
            let req, body;

            this.connected = false;
            this.token = null;
            if (this.config.googleAuth) {
                let issueToken = this.config.googleAuth.issueToken;
                let cookies = this.config.googleAuth.cookies;

                this.debug('Authenticating via Google.');
                try {
                    req = {
                        method: 'GET',
                        followAllRedirects: true,
                        timeout: API_TIMEOUT_SECONDS * 1000,
                        uri: issueToken,
                        headers: {
                            'Sec-Fetch-Mode': 'cors',
                            'User-Agent': USER_AGENT_STRING,
                            'X-Requested-With': 'XmlHttpRequest',
                            'Referer': 'https://accounts.google.com/o/oauth2/iframe',
                            'cookie': cookies
                        },
                        json: true
                    };
                    let result = yield rp(req);
                    let googleAccessToken = result.access_token;
                    req = {
                        method: 'POST',
                        followAllRedirects: true,
                        timeout: API_TIMEOUT_SECONDS * 1000,
                        uri: 'https://nestauthproxyservice-pa.googleapis.com/v1/issue_jwt',
                        body: {
                            embed_google_oauth_access_token: true,
                            expire_after: '3600s',
                            google_oauth_access_token: googleAccessToken,
                            policy_id: 'authproxy-oauth-policy'
                        },
                        headers: {
                            'Authorization': 'Bearer ' + googleAccessToken,
                            'User-Agent': USER_AGENT_STRING,
                            'x-goog-api-key': this.config.googleAuth.apiKey,
                            'Referer': 'https://home.nest.com'
                        },
                        json: true
                    };
                    result = yield rp(req);
                    this.config.access_token = result.jwt;
                } catch (error) {
                    this.error('Google authentication failed (code ' + (error.statusCode || (error.cause && error.cause.code)) + ').');
                    this.failedAuthAPICalls++;
                    if (this.failedAuthAPICalls < API_AUTH_FAIL_MAX_CALLS) {
                        this.error('Retrying in ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' second(s).');
                        Promise.delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000).then(() => this.auth()).then(connected => resolve(connected));
                        return;
                    } else {
                        this.error('Maximum number of authentication attempts made.');
                        resolve(false);
                    }
                }
            } else if (this.config.authenticator) {
                // Call external endpoint to refresh the token
                this.debug('Acquiring access token via external authenticator.');
                try {
                    req = {
                        method: 'POST',
                        followAllRedirects: true,
                        timeout: API_TIMEOUT_SECONDS * 1000,
                        uri: this.config.authenticator,
                        body: this.config,
                        json: true
                    };
                    let result = yield rp(req);
                    if (result.status == 'OK' && result.access_token) {
                        this.config.access_token = result.access_token;
                    } else {
                        throw({ retry: result.retry, cause: { code: result.code } });
                    }
                } catch(error) {
                    this.error('Access token acquisition failed (code ' + (error.statusCode || (error.cause && error.cause.code)) + ').');
                    if (error.retry) {
                        this.error('Retrying in ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' second(s).');
                        Promise.delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000).then(() => this.auth()).then(connected => resolve(connected));
                        return;
                    }
                }
            }

            if (this.config.access_token) {
                if (!this.config.googleAuth) {
                    this.debug('Authenticating via access token.');
                }

                req = {
                    method: 'GET',
                    followAllRedirects: true,
                    timeout: API_TIMEOUT_SECONDS * 1000,
                    uri: URL_NEST_AUTH,
                    headers: {
                        'Authorization': 'Basic ' + this.config.access_token,
                        'User-Agent': USER_AGENT_STRING
                    },
                    json: true
                };
            } else if (!this.config.googleAuth && !this.config.authenticator) {
                this.debug('Authenticating via Nest account.');
                req = {
                    method: 'POST',
                    followAllRedirects: true,
                    timeout: API_TIMEOUT_SECONDS * 1000,
                    uri: URL_NEST_AUTH,
                    headers: {
                        'Authorization': 'Basic',
                        'User-Agent': USER_AGENT_STRING
                    },
                    body: {
                        email: this.config.email,
                        password: this.config.password
                    },
                    json: true
                };
            } else {
                resolve(false);
                return;
            }

            try {
                body = yield rp(req);
                this.connected = true;
                this.token = body.access_token;
                this.transport_url = body.urls.transport_url;
                this.userid = body.userid;
                resolve(true);
            } catch(error) {
                this.connected = false;
                if (error.statusCode == 401 && error.response && error.response.body && error.response.body.truncated_phone_number) {
                    // 2FA required
                    let getPIN;

                    this.log('Your Nest account has 2-factor authentication enabled.');
                    if (this.config.pin) {
                        this.log('Using PIN ' + this.config.pin + ' from config.json.');
                        this.log('If authentication fails, check this matches the 6-digit PIN sent to your phone number ending ' + error.response.body.truncated_phone_number + '.');
                        getPIN = Promise.resolve(this.config.pin);
                    } else {
                        this.log('Please enter the 6-digit PIN sent to your phone number ending ' + error.response.body.truncated_phone_number + '.');
                        getPIN = Prompt('PIN: ');
                    }
                    try {
                        let pin = yield getPIN;
                        let result = yield rp({
                            method: 'POST',
                            followAllRedirects: true,
                            timeout: API_TIMEOUT_SECONDS * 1000,
                            uri: URL_NEST_VERIFY_PIN,
                            body: {
                                pin: pin,
                                '2fa_token': error.response.body['2fa_token']
                            },
                            json: true
                        });
                        body = yield rp({
                            method: 'GET',
                            followAllRedirects: true,
                            timeout: API_TIMEOUT_SECONDS * 1000,
                            uri: URL_NEST_AUTH,
                            headers: {
                                'Authorization': 'Basic ' + result.access_token,
                                'User-Agent': USER_AGENT_STRING
                            },
                            json: true
                        });
                        this.connected = true;
                        this.token = body.access_token;
                        this.transport_url = body.urls.transport_url;
                        this.userid = body.userid;
                        resolve(true);
                    } catch(error) {
                        this.error('Auth failed: 2FA PIN was rejected');
                        resolve(false);
                    }
                } else if (error.statusCode == 400) {
                    if (this.config.access_token) {
                        this.error('Auth failed: access token specified in Homebridge configuration rejected');
                    } else {
                        this.error('Auth failed: Nest rejected the account email/password specified in your Homebridge configuration file. Please check');
                    }
                    resolve(false);
                } else if (error.statusCode == 429) {
                    this.error('Auth failed: rate limit exceeded. Please try again in 60 minutes');
                    resolve(false);
                } else {
                    this.error('Could not authenticate with Nest (code ' + (error.statusCode || (error.cause && error.cause.code)) + '). Retrying in ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' second(s).');
                    Promise.delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000).then(() => this.auth()).then(connected => resolve(connected));
                }
            }
        }).call(this);
    });
};

Connection.prototype.mergePendingUpdates = function(unmergedBody) {
    let body = cloneObject(unmergedBody);

    this.mergeUpdates.forEach(update => {
        let expiryTime = update.expiry_time;
        let obj = update.object;

        if (expiryTime > Date.now()) {
            let deviceType = obj.object_key.split('.')[0];
            let deviceId = obj.object_key.split('.')[1];
            Object.keys(obj.value).forEach(key => {
                if (body[deviceType] && body[deviceType][deviceId]) {
                    this.verbose(deviceType + '.' + deviceId + '.' + key + ': overriding', body[deviceType][deviceId][key], '->', obj.value[key]);
                    body[deviceType][deviceId][key] = obj.value[key];
                }
            });
        }
    });

    return body;
};

Connection.prototype.updateData = function() {
    let uri =  this.objectList.objects.length ? this.transport_url + ENDPOINT_SUBSCRIBE : 'https://home.nest.com/api/0.1/user/' + this.userid + '/app_launch';
    let body = this.objectList.objects.length ? this.objectList : {'known_bucket_types':['structure','shared','topaz','device','rcs_settings','kryptonite','track','where'],'known_bucket_versions':[]};

    if (!this.token || !this.connected) {
        this.verbose('API subscribe deferred as not connected to Nest.');
        return Promise.delay(API_TIMEOUT_SECONDS * 1000).then(() => { return null; });
    }

    this.verbose('API subscribe POST: ' + (this.objectList.objects.length ? 'subscribing' : 'app launch'));
    return rp({
        method: 'POST',
        followAllRedirects: true,
        timeout: API_SUBSCRIBE_TIMEOUT_SECONDS * 1000,
        uri: uri,
        headers: {
            'User-Agent': USER_AGENT_STRING,
            'Authorization': 'Basic ' + this.token,
            'X-nl-user-id': this.userid,
            'X-nl-protocol-version': 1
        },
        body: body,
        json: true,
        gzip: true
    }).then(rawBody => {
        let body = this.mergePendingUpdates(createNestBody(this.currentState, rawBody.updated_buckets || rawBody.objects, this.objectList));
        return apiResponseToObjectTree(body);
    });
};

function apiResponseToObjectTree(body) {
    let data = {};
    data.devices = {};
    data.devices['thermostats'] = {};
    data.devices['home_away_sensors'] = {};
    data.devices['temp_sensors'] = {};
    data.devices['smoke_co_alarms'] = {};

    let structures = body.structure || {};
    let shared = body.shared || {};
    let topaz = body.topaz || {};
    let device = body.device || {};
    let rcs_settings = body.rcs_settings || {};
    let kryptonite = body.kryptonite || {};
    let track = body.track || {};

    Object.keys(structures).forEach(structureId => {
        let thisStructure = structures[structureId];

        let whereLookup = {};
        if (body.where[structureId]) {
            let wheres = body.where[structureId].wheres || {};
            wheres.forEach(where => whereLookup[where.where_id] = where.name);
        }

        thisStructure.structure_id = structureId;

        let swarm = thisStructure.swarm;
        swarm.map(unit => unit.split('.')).forEach(unit => {
            let deviceType = unit[0];
            let deviceId = unit[1];

            if (deviceType == 'device') {
                // Detected thermostat

                data.devices['thermostats'][deviceId] = device[deviceId];
                let thisDevice = data.devices['thermostats'][deviceId];

                Object.keys(shared[deviceId]).forEach(sKey => {
                    thisDevice[sKey] = shared[deviceId][sKey];
                });

                thisDevice.device_id = deviceId;
                thisDevice.structure_id = structureId;
                thisDevice.where_name = whereLookup[thisDevice.where_id];
                thisDevice.name = thisDevice.name || thisDevice.where_name || 'Nest Thermostat';
                thisDevice.fan_timer_active = thisDevice.fan_timer_timeout > 0;
                thisDevice.previous_hvac_mode = thisDevice.target_temperature_type.toLowerCase();
                thisDevice.hvac_mode = (thisDevice.eco.mode == 'manual-eco' || thisDevice.eco.mode == 'auto-eco') ? 'eco' : thisDevice.previous_hvac_mode;
                thisDevice.software_version = thisDevice.current_version;
                thisDevice.hvac_state = (thisDevice.can_heat && thisDevice.hvac_heater_state) ? 'heating' : (thisDevice.can_cool && thisDevice.hvac_ac_state ? 'cooling' : 'off');
                thisDevice.is_online = track[deviceId] && track[deviceId].online;

                // Add data for any Nest Temperature Sensors
                if (rcs_settings[deviceId] && rcs_settings[deviceId].associated_rcs_sensors) {
                    rcs_settings[deviceId].associated_rcs_sensors.forEach(sensorName => {
                        let sensorId = sensorName.split('.')[1];
                        let thisSensor = kryptonite[sensorId];
                        if (thisSensor) {
                            data.devices['temp_sensors'][sensorId] = {
                                thermostat_device_id: deviceId,
                                structure_id: structureId,
                                device_id: sensorId,
                                serial_number: thisSensor.serial_number,
                                name: whereLookup[thisSensor.where_id] || 'Nest Temperature Sensor',
                                current_temperature: thisSensor.current_temperature,
                                temperature_scale: thisDevice.temperature_scale
                            };
                        }
                    });
                }

                // Set up home/away sensor
                data.devices['home_away_sensors'][structureId] = {};
                data.devices['home_away_sensors'][structureId].structure_id = structureId;
                data.devices['home_away_sensors'][structureId].device_id = structureId;
                data.devices['home_away_sensors'][structureId].software_version = thisDevice.current_version;
                data.devices['home_away_sensors'][structureId].serial_number = thisDevice.serial_number;
                data.devices['home_away_sensors'][structureId].name = 'Home/Away';
                data.devices['home_away_sensors'][structureId].away = thisStructure.away;
            } else if (deviceType == 'topaz') {
                // Detected Nest Protect

                data.devices['smoke_co_alarms'][deviceId] = topaz[deviceId];
                let thisDevice = data.devices['smoke_co_alarms'][deviceId];
                thisDevice.device_id = deviceId;
                thisDevice.where_name = whereLookup[thisDevice.where_id];
                thisDevice.name = thisDevice.description || thisDevice.where_name || 'Nest Protect';
                thisDevice.smoke_alarm_state = (thisDevice.smoke_status == 0) ? 'ok' : 'emergency';
                thisDevice.co_alarm_state = (thisDevice.co_status == 0) ? 'ok' : 'emergency';
                thisDevice.battery_health = (thisDevice.battery_health_state == 0) ? 'ok' : 'low';
                thisDevice.is_online = thisDevice.component_wifi_test_passed;

                // Set up home/away sensor
                if (Object.keys(data.devices['home_away_sensors']).length == 0) {
                    data.devices['home_away_sensors'][structureId] = {};
                    data.devices['home_away_sensors'][structureId].structure_id = structureId;
                    data.devices['home_away_sensors'][structureId].device_id = structureId;
                    data.devices['home_away_sensors'][structureId].software_version = thisDevice.software_version;
                    data.devices['home_away_sensors'][structureId].serial_number = thisDevice.serial_number;
                    data.devices['home_away_sensors'][structureId].name = 'Home/Away';
                    data.devices['home_away_sensors'][structureId].away = thisDevice.topaz_away;
                }
            }
        });
    });

    data.structures = structures;
    // this.currentData = data;
    return data;
}

Connection.prototype.dataTimerLoop = function(resolve, handler) {
    var notify = resolve || handler;
    var apiLoopTimer;

    this.updateData().then(data => {
        if (data) {
            this.verbose('API subscribe POST: got updated data');
            notify(data);
            // callNotify(this, notify, data);
        }
    }).catch(error => {
        if (!error.cause || (error.cause && error.cause.code != 'ESOCKETTIMEDOUT')) {
            if (!error.statusCode || error.statusCode != 401) {
                // 401 responses are normal when reauthentication is required - not actually a real "error"
                this.error('Nest API call to subscribe to device settings updates returned an error: ' + (error.statusCode || (error.cause && error.cause.code)) || error);
            }
            if (error.statusCode == 401 || error.statusCode == 403 || (error.cause && error.cause.code == 'ECONNREFUSED')) {
                // Token has probably expired, or transport endpoint has changed - re-authenticate
                this.log('Reauthenticating on Nest service ...');
                return this.auth().catch(() => {
                    this.log('Reauthentication failed, waiting for ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' seconds.');
                    return Promise.delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000);
                });
            } else {
                this.log('Retrying in ' + API_TIMEOUT_SECONDS + ' seconds.');
                return Promise.delay(API_TIMEOUT_SECONDS * 1000);
            }
        }
    }).finally(() => {
        apiLoopTimer = setInterval(() => {
            if (apiLoopTimer) {
                clearInterval(apiLoopTimer);
            }
            this.dataTimerLoop(null, handler);
        }, API_SUBSCRIBE_DELAY_SECONDS * 1000);
    });
};

Connection.prototype.subscribe = function(handler) {
    this.updateHomeKit = handler;
    return new Promise(resolve => {
        this.dataTimerLoop(resolve, handler);
    });
};

Connection.prototype.update = function(device, property, value, hvac_mode) {
    this.debug(device, property, value);

    let body = {};
    body[property] = value;

    let deviceType = device.split('.')[0];
    let deviceId = device.split('.')[1];

    if (deviceType == 'structure') {
        if (property == 'away') {
            body = { away: value == 'away', away_timestamp: getUnixTime(), away_setter: 0 };
        }
    } else if (deviceType == 'shared') {
        if (property == 'hvac_mode') {
            if (['eco', 'eco-off'].includes(value)) {
                deviceType = 'device';
                body = { eco: { mode: value == 'eco' ? 'manual-eco' : 'schedule' } };
            } else {
                this.commitUpdate('device.' + deviceId, { eco: { mode: 'schedule' } });
                body = { target_change_pending: true, target_temperature_type: value };
            }
        }
    } else if (deviceType == 'device') {
        if (property == 'away_temperature_high') {
            body.away_temperature_high_enabled = true;
        } else if (property == 'away_temperature_low') {
            body.away_temperature_low_enabled = true;
        } else if (property == 'fan_timer_active') {
            body = { fan_timer_timeout: value ? getUnixTime() + ((this.config.fanDurationMinutes || DEFAULT_FAN_DURATION_MINUTES) * 60) : 0 };
        }
    }

    let nodeId = deviceType + '.' + deviceId;
    this.commitUpdate(nodeId, body, hvac_mode);
    return Promise.resolve();
};

Connection.prototype.commitUpdate = function(nodeId, body, hvac_mode) {
    this.verbose('Committing update', nodeId, body);

    let newApiObject = createApiObject(nodeId, body);

    // Purge expired merge updates
    this.mergeUpdates = this.mergeUpdates.filter(obj => obj.expiry_time > Date.now());
    // First add the update to the merge updates cache - these updates will "force" for a specified time interval to allow the Nest API to catch up
    this.mergeUpdates.push({ expiry_time: Date.now() + API_MERGE_PENDING_MAX_SECONDS * 1000, object: newApiObject });

    if (this.mergeEndTimer) {
        clearTimeout(this.mergeEndTimer);
    }
    this.mergeEndTimer = setTimeout(() => {
        this.verbose('Re-syncing with Nest API state.');
        this.updateHomeKit(apiResponseToObjectTree(this.currentState));
    }, API_MERGE_PENDING_MAX_SECONDS * 1000);

    if (body.target_temperature_type || body.eco || body.away) {
        // Changing mode -> push immediately
        this.pushUpdates([{ hvac_mode: hvac_mode, object: newApiObject }]);
        this.lastModeChangeTime = Date.now();
    } else {
        // Otherwise add to pending updates
        let updatingExistingKey = false;
        this.pendingUpdates.forEach(obj => {
            if (obj.object.object_key == nodeId) {
                updatingExistingKey = true;
                Object.keys(body).forEach(key => {
                    obj.object.value[key] = cloneObject(body)[key];
                });
            }
        });
        if (!updatingExistingKey) {
            this.pendingUpdates.push({ hvac_mode: hvac_mode, object: newApiObject });
        }
        this.pushUpdatesDebounced();
    }
};

Connection.prototype.pushUpdatesDebounced = debounce(function() {
    this.pushUpdates();
}, API_PUSH_DEBOUNCE_SECONDS * 1000, { maxWait: API_PUSH_DEBOUNCE_MAXWAIT_SECONDS * 1000 });

Connection.prototype.pushUpdates = function(data) {
    let updatesToSend = cloneObject(data || this.pendingUpdates);

    if (updatesToSend.length == 0) {
        return Promise.resolve(null);
    }

    if (!this.token || !this.connected) {
        this.verbose('API push updates cancelled as not connected to Nest.');
        return Promise.resolve(null);
    }

    // Work around for strange Siri bug which tries to set heating/cooling threshold instead of actual temperature when
    // setting low or high temperatures
    updatesToSend.forEach((el, index) => {
        if (el.hvac_mode != 'range' && !el.object.value.target_temperature && (el.object.value.target_temperature_low || el.object.value.target_temperature_high)) {
            updatesToSend[index].object.value = { target_temperature: el.object.value.target_temperature_low || el.object.value.target_temperature_high };
        }
    });

    if (!data) {
        this.pendingUpdates = [];
    }

    // Enforce minimum delay after mode change before pushing
    let additionalDelay = 0;
    if (!data && this.lastModeChangeTime) {
        additionalDelay = Math.max((API_MODE_CHANGE_DELAY_SECONDS * 1000) - (Date.now() - this.lastModeChangeTime), 0);
    }

    if (this.failedPushAPICalls > 2) {
        additionalDelay += API_TIMEOUT_SECONDS * 1000;
    }

    this.verbose('Pushing updates', updatesToSend.length, 'in', additionalDelay, 'ms');
    updatesToSend.forEach((el, index) => {
        this.verbose(index, '-', el.object);
    });

    return Promise.delay(additionalDelay).then(() => rp({
        method: 'POST',
        followAllRedirects: true,
        timeout: API_TIMEOUT_SECONDS * 1000,
        uri: this.transport_url + ENDPOINT_PUT,
        headers: {
            'User-Agent': USER_AGENT_STRING,
            'Authorization': 'Basic ' + this.token,
            'X-nl-protocol-version': 1
        },
        body: {
            objects: updatesToSend.map(el => el.object)
        },
        json: true
    })).then(() => {
        this.failedPushAPICalls = 0;
    }).catch(error => {
        this.failedPushAPICalls++;
        if (!error.statusCode || error.statusCode != 401) {
            // 401 responses are normal when reauthentication is required - not actually a real "error"
            this.error('Nest API call to change device settings returned an error: ' + (error.statusCode || (error.cause && error.cause.code)));
        }
        if (error.statusCode == 401 || error.statusCode == 403 || (error.cause && ['ECONNREFUSED','ESOCKETTIMEDOUT','ENOTFOUND'].includes(error.cause.code))) {
            // Token has probably expired, or transport endpoint has changed - re-authenticate and try again
            let additionalUpdates = this.pendingUpdates;
            this.pendingUpdates = updatesToSend;
            additionalUpdates.forEach(el => this.pendingUpdates.push(el));

            this.log('Reauthenticating on Nest service ...');
            return this.auth().then(() => {
                if (this.mergeEndTimer) {
                    clearTimeout(this.mergeEndTimer);
                }
            }).catch(() => {
                this.log('Reauthentication failed, waiting for ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' seconds.');
                return Promise.delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000);
            }).finally(() => {
                return this.pushUpdates(data);
            });
        }
    });
};

function getUnixTime() {
    return Math.floor(Date.now() / 1000);
}

function createNestBody(currentState, objects, objectList) {
    objects.forEach(obj => {
        let cloneObj = cloneObject(obj);
        let index = objectList.objects.findIndex(el => el.object_key === obj.object_key);
        if (index > -1) {
            objectList.objects[index] = cloneObj;
        } else {
            objectList.objects.push(cloneObj);
        }

        let key = cloneObj.object_key.split('.')[0];
        let value = cloneObj.object_key.split('.')[1];
        if (!currentState[key]) {
            currentState[key] = {};
        }
        currentState[key][value] = cloneObj.value;
    });

    return currentState;
}

function cloneObject(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function createApiObject(nodeId, value) {
    return {
        object_key: nodeId,
        op: 'MERGE',
        value: cloneObject(value)
    };
}
