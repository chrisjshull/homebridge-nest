/**
 * Created by Adrian Cable on 7/16/19.
 */

const Promise = require('bluebird');
const rp = require('request-promise');
const Prompt = require('promise-prompt');

'use strict';

module.exports = Connection;

// Amount of time to run the fan when accessory is turned on, unless overridden in config.json
const DEFAULT_FAN_DURATION_MINUTES = 15;

// Delay after authentication fail before retrying
const API_AUTH_FAIL_RETRY_DELAY_SECONDS = 10;

// Interval between Nest subscribe requests
const API_SUBSCRIBE_DELAY_SECONDS = 0.1;

// Timeout API calls after this number of seconds
const API_TIMEOUT_SECONDS = 60;

// We want to look like a browser
const USER_AGENT_STRING = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.100 Safari/537.36';

// Endpoint URLs
const URL_NEST_AUTH = 'https://home.nest.com/session';
const URL_NEST_VERIFY_PIN = 'https://home.nest.com/api/0.1/2fa/verify_pin';

function Connection(token, log, verbose) {
    this.token = token;
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

Connection.prototype.auth = function(email, password, forcePIN) {
    this.mutex.startApiUpdate();
    return new Promise((resolve, reject) => {
        rp({
            method: 'POST',
            timeout: API_TIMEOUT_SECONDS * 1000,
            uri: URL_NEST_AUTH,
            headers: {
                'Authorization': 'Basic',
                'User-Agent': USER_AGENT_STRING
            },
            body: {
                email: email,
                password: password
            },
            json: true
        }).then(body => {
            this.token = body.access_token;
            this.transport_url = body.urls.transport_url;
            this.userid = body.userid;
            this.loggedin_email = email;
            this.loggedin_password = password;
            this.objectList = { objects: [] };
            this.currentState = {};
            resolve(this.token);
        }).catch(error => {
            if (error.statusCode == 401) {
                // 2FA required
                let getPIN;

                this.log('Your Nest account has 2-factor authentication enabled.');
                if (forcePIN) {
                    this.log('Using PIN ' + forcePIN + ' from config.json.');
                    this.log('If authentication fails, check this matches the 6-digit PIN sent to your phone number ending ' + error.response.body.truncated_phone_number + '.');
                    getPIN = Promise.resolve(forcePIN);
                } else {
                    this.log('Please enter the 6-digit PIN sent to your phone number ending ' + error.response.body.truncated_phone_number + '.');
                    getPIN = Prompt('PIN: ');
                }
                getPIN.then(pin => {
                    return rp({
                        method: 'POST',
                        timeout: API_TIMEOUT_SECONDS * 1000,
                        uri: URL_NEST_VERIFY_PIN,
                        body: {
                            pin: pin,
                            '2fa_token': error.response.body['2fa_token']
                        },
                        json: true
                    });
                }).then(result => {
                    return rp({
                        method: 'GET',
                        timeout: API_TIMEOUT_SECONDS * 1000,
                        uri: URL_NEST_AUTH,
                        headers: {
                            'Authorization': 'Basic ' + result.access_token,
                            'User-Agent': USER_AGENT_STRING
                        },
                        json: true
                    });
                }).then(body => {
                    this.token = body.access_token;
                    this.transport_url = body.urls.transport_url;
                    this.userid = body.userid;
                    this.loggedin_email = email;
                    this.loggedin_password = password;
                    this.objectList = { objects: [] };
                    this.currentState = {};
                    resolve(this.token);
                }).catch(() => {
                    reject({ code: '2fa_error' });
                });
            } else {
                this.log('Could not connect to Nest authentication service. Retrying in ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' second(s).');
                resolve(Promise.delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000).then(() => this.auth(email, password, forcePIN)));
                // reject({ code: error.statusCode });
            }
        }).finally(() => this.mutex.endApiUpdate());
    });
};

Connection.prototype.initSession = function() {
    this.mutex.startApiUpdate();
    return new Promise((resolve, reject) => {
        rp({
            method: 'GET',
            timeout: API_TIMEOUT_SECONDS * 1000,
            uri: 'https://home.nest.com/session',
            headers: {
                'Authorization': 'Basic ' + this.token,
                'User-Agent': USER_AGENT_STRING
            },
            json: true
        }).then(body => {
            this.token = body.access_token;
            this.transport_url = body.urls.transport_url;
            this.userid = body.userid;
            this.objectList = { objects: [] };
            this.currentState = {};
            resolve(this.token);
        }).catch(error => {
            reject({ code: error.statusCode });
        }).finally(() => this.mutex.endApiUpdate());
    });
}

Connection.prototype.updateData = function() {
    if (this.mutex.isApiUpdatePending() || this.mutex.isTemperatureUpdatePending()) {
    // Don't get a data update if we are in the middle of pushing updated settings to the device
        this.verbose('API: get status update deferred [before call issue] as property change active', this.mutex.getPropertySetPending());
        return Promise.resolve(null);
    }

    let data = {};
    let uri =  this.objectList.objects.length ? this.transport_url + '/v5/subscribe' : 'https://home.nest.com/api/0.1/user/' + this.userid + '/app_launch';
    let body = this.objectList.objects.length ? this.objectList : {'known_bucket_types':['buckets','delayed_topaz','demand_response','device','device_alert_dialog','geofence_info','kryptonite','link','message','message_center','metadata','occupancy','quartz','safety','rcs_settings','safety_summary','schedule','shared','structure','structure_history','structure_metadata','topaz','topaz_resource','track','trip','tuneups','user','user_alert_dialog','user_settings','where','widget_track'],'known_bucket_versions':[]};

    return rp({
        method: 'POST',
        timeout: API_TIMEOUT_SECONDS * 1000,
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
        let body = createNestBody(this.currentState, rawBody.updated_buckets || rawBody.objects, this.objectList);

        data.devices = {};
        data.devices['thermostats'] = {};
        data.devices['smoke_co_alarms'] = {};
        data.devices['temp_sensors'] = {};
        data.devices['home_away_sensors'] = {};

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
                                    current_temperature: thisSensor.current_temperature
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
                        data.devices['home_away_sensors'][structureId].software_version = thisDevice.current_version;
                        data.devices['home_away_sensors'][structureId].serial_number = thisDevice.serial_number;
                        data.devices['home_away_sensors'][structureId].name = 'Home/Away';
                        data.devices['home_away_sensors'][structureId].away = thisDevice.topaz_away;
                    }
                }
            });
        });
    
        data.structures = structures;
        return data;
    });
};

Connection.prototype.dataTimerLoop = function(resolve, handler) {
    var notify = resolve || handler;
    var apiLoopTimer;

    this.updateData().then(data => {
        if (data) {
            this.verbose('API subscribe POST: got updated data');
            notify(data);
        }
    }).catch(error => {
        if (!error.cause || (error.cause && error.cause.code != 'ESOCKETTIMEDOUT')) {
            this.debug('Nest_API_error', error);
            if (error.statusCode == 401 || error.statusCode == 403 || (error.cause && error.cause.code == 'ECONNREFUSED')) {
                // Token has probably expired, or transport endpoint has changed - re-authenticate
                this.log('Reauthenticating on Nest service ...');
                this.auth(this.loggedin_email, this.loggedin_password);
            }
        }
    }).finally(() => {
        apiLoopTimer = setInterval(() => {
            if (apiLoopTimer) {
                clearInterval(apiLoopTimer);
            }
            this.verbose('API subscribe POST: subscribing');
            this.dataTimerLoop(null, handler);
        }, API_SUBSCRIBE_DELAY_SECONDS * 1000);
    });
};

Connection.prototype.subscribe = function(handler) {
    return new Promise(resolve => {
        this.dataTimerLoop(resolve, handler);
    });
};

Connection.prototype.update = function(device, property, value) {
    this.debug(device, property, value);

    let body = {}, additionalPushObject;
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
                additionalPushObject = createApiObject('device' + '.' + deviceId, { eco: { mode: 'schedule' } });
                body = { target_temperature_type: value };
            }
        }
    } else if (deviceType == 'device') {
        if (property == 'away_temperature_high' ) {
            body.away_temperature_high_enabled = true;
        } else if (property == 'away_temperature_low' ) {
            body.away_temperature_low_enabled = true;
        } else if (property == 'fan_timer_active' ) {
            body = { fan_timer_timeout: value ? getUnixTime() + ((this.config.fanDurationMinutes || DEFAULT_FAN_DURATION_MINUTES) * 60) : 0 };
        }
    }

    let nodeId = deviceType + '.' + deviceId;
    let url = this.transport_url + '/v5/put';
    let objects = [ createApiObject(nodeId, body) ];
    if (additionalPushObject) {
        objects.push(additionalPushObject);
    }

    this.mutex.startApiUpdate();
    return Promise.resolve(rp({
        method: 'POST',
        timeout: API_TIMEOUT_SECONDS * 1000,
        uri: url,
        headers: {
            'User-Agent': USER_AGENT_STRING,
            'Authorization': 'Basic ' + this.token,
            'X-nl-protocol-version': 1
        },
        body: {
            objects: objects
        },
        json: true
    })).catch(error => {
        this.log('Nest API call to change device settings returned an error: ' + error.statusCode);
    }).finally(() => this.mutex.endApiUpdate());
};

function getUnixTime() {
    return Math.floor(Date.now() / 1000);
}

function createNestBody(currentState, objects, objectList) {
    objects.forEach(obj => {
        let index = objectList.objects.findIndex(el => el.object_key === obj.object_key);
        if (index > -1) {
            objectList.objects[index] = cloneObject(obj);
        } else {
            objectList.objects.push(cloneObject(obj));
        }

        let key = obj.object_key.split('.')[0];
        let value = obj.object_key.split('.')[1];
        if (!currentState[key]) {
            currentState[key] = {};
        }
        currentState[key][value] = obj.value;
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
        value: value
    };
}
