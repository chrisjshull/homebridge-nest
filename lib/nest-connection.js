/**
 * Created by Adrian Cable on 7/16/19.
 */

'use strict';

const debounce = require('lodash.debounce');
const axios = require('axios');
const Prompt = require('promise-prompt');
const fs = require('fs');
const varint = require('varint');
const protobuf = require('protobufjs');
const http2 = require('http2');

const NestEndpoints = require('./nest-endpoints.js');

// Amount of time to run the fan when accessory is turned on, unless overridden in config.json
const DEFAULT_FAN_DURATION_MINUTES = 15;

// Amount of time to run hot water (UK/EU thermostats) when accessory is turned on, unless overridden in config.json
const DEFAULT_HOT_WATER_DURATION_MINUTES = 30;

// Delay after authentication fail before retrying
const API_AUTH_FAIL_RETRY_DELAY_SECONDS = 15;

// Delay after authentication fail (long) before retrying
const API_AUTH_FAIL_RETRY_LONG_DELAY_SECONDS = 60 * 60;

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

// Timeout observe API calls after this number of seconds
const API_OBSERVE_TIMEOUT_SECONDS = (10 * 60) + 10;

// Timeout other API calls after this number of seconds
const API_TIMEOUT_SECONDS = 40;

// Delay after API call failure before trying again
const API_RETRY_DELAY_SECONDS = 10;

// Pre-emptive reauthentication interval for Google accounts
const API_GOOGLE_REAUTH_MINUTES = 55;

// Pre-emptive reauthentication interval for Nest accounts
const API_NEST_REAUTH_MINUTES = 20 * 24 * 60;

class Connection {
    constructor(config, log, verbose, fieldTestMode) {
        NestEndpoints.init(fieldTestMode);

        this.config = config;
        this.token = null;
        this.connected = false;
        this.objectList = { objects: [] };
        this.mountedDeviceCount = { rest: { }, protobuf: { } };
        this.currentState = {};
        this.lastModeChangeTime = null;
        this.mergeEndTimer = null;
        this.updateHomeKit = null;
        this.failedPushAPICalls = 0;
        this.proto = {};
        this.StreamBody = null;
        this.TraitMap = null;
        this.protobufUserId = null;
        this.legacyStructureMap = {};
        this.legacyDeviceMap = {};
        this.protobufBody = {};
        this.lastProtobufCode = null;
        this.pollTimes = {};
        this.transcoderProcesses = [];
        this.associatedStreamers = [];
        this.preemptiveReauthTimer = null;
        this.cancelObserve = null;
        this.connectionFailures = 0;
        this.pendingUpdates = [];
        this.mergeUpdates = [];
        this.connected = false;

        protobuf.load(__dirname + '/protobuf/root.proto').then(root => {
            this.proto.root = root;
            this.StreamBody = root.lookupType('nest.rpc.StreamBody');
            this.TraitMap = root.lookupType('nest.rpc.NestMessage');
        });

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

        this.pushUpdatesDebounced = debounce(function() {
            this.pushUpdates();
        }, API_PUSH_DEBOUNCE_SECONDS * 1000, { maxWait: API_PUSH_DEBOUNCE_MAXWAIT_SECONDS * 1000 });
    }

    async auth(preemptive) {
        let req, body;

        // eslint-disable-next-line
        while (true) {
            // Will return when authed successfully, or throw when cannot retry

            if (!preemptive) {
                this.connected = false;
                this.token = null;
            }
            if (this.config.googleAuth) {
                let issueToken = this.config.googleAuth.issueToken;
                let cookies = this.config.googleAuth.cookies;

                this.debug('Authenticating via Google.');
                let result;
                try {
                    req = {
                        method: 'GET',
                        // followAllRedirects: true,
                        timeout: API_TIMEOUT_SECONDS * 1000,
                        url: issueToken,
                        headers: {
                            'Sec-Fetch-Mode': 'cors',
                            'User-Agent': NestEndpoints.USER_AGENT_STRING,
                            'X-Requested-With': 'XmlHttpRequest',
                            'Referer': 'https://accounts.google.com/o/oauth2/iframe',
                            'cookie': cookies
                        }
                    };
                    result = (await axios(req)).data;
                    let googleAccessToken = result.access_token;
                    if (result.error) {
                        this.error('Google authentication was unsuccessful. Make sure you did not log out of your Google account after getting your googleAuth parameters.');
                        throw(result);
                    }
                    req = {
                        method: 'POST',
                        // followAllRedirects: true,
                        timeout: API_TIMEOUT_SECONDS * 1000,
                        url: 'https://nestauthproxyservice-pa.googleapis.com/v1/issue_jwt',
                        data: {
                            embed_google_oauth_access_token: true,
                            expire_after: '3600s',
                            google_oauth_access_token: googleAccessToken,
                            policy_id: 'authproxy-oauth-policy'
                        },
                        headers: {
                            'Authorization': 'Bearer ' + googleAccessToken,
                            'User-Agent': NestEndpoints.USER_AGENT_STRING,
                            'x-goog-api-key': this.config.googleAuth.apiKey?.replace('x-goog-api-key: ', '') ||
      (this.config.fieldTest ? 'AIzaSyB0WNyJX2EQQujlknzTDD9jz7iVHK5Jn-U' : 'AIzaSyAdkSIMNc51XGNEAYWasX9UOWkS5P6sZE4');
                            'Referer': 'https://' + NestEndpoints.NEST_API_HOSTNAME
                        }
                    };
                    result = (await axios(req)).data;
                    this.config.access_token = result.jwt;
                } catch (error) {
                    error.status = error.response && error.response.status;
                    this.error('Access token acquisition via googleAuth failed (code ' + (error.status || error.code || error.error) + ').');
                    if (error.status == 400) {
                        // Cookies expired
                        return false;
                    }
                    if ((error.status && error.status >= 500) || ['ECONNREFUSED','ENOTFOUND','ESOCKETTIMEDOUT','ECONNABORTED','ENETUNREACH','EAI_AGAIN','DEPTH_ZERO_SELF_SIGNED_CERT'].includes(error.code)) {
                        this.error('Retrying in ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' second(s).');
                        await Promise.delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000);
                        continue;
                        // return await this.auth();
                    }
                }
            } else if (this.config.authenticator) {
                // Call external endpoint to refresh the token
                this.debug('Acquiring access token via external authenticator.');
                try {
                    req = {
                        method: 'POST',
                        // followAllRedirects: true,
                        timeout: API_TIMEOUT_SECONDS * 1000,
                        url: this.config.authenticator,
                        data: this.config
                    };
                    let result = (await axios(req)).data;
                    if (result.status == 'OK' && result.access_token) {
                        this.config.access_token = result.access_token;
                    } else {
                        throw({retry: result.retry, code: result.code});
                    }
                } catch (error) {
                    error.status = error.response && error.response.status;
                    this.error('Access token acquisition failed (code ' + (error.status || error.code) + ').');
                    if (error.retry || error.errno) {
                        this.error('Retrying in ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' second(s).');
                        await Promise.delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000);
                        continue;
                        // return await this.auth();
                    }
                }
            }

            let rcKey, rcToken;
            if (this.config.access_token) {
                if (!this.config.googleAuth) {
                    this.debug('Authenticating via access token.');
                }

                req = {
                    method: 'GET',
                    // followAllRedirects: true,
                    timeout: API_TIMEOUT_SECONDS * 1000,
                    url: NestEndpoints.URL_NEST_AUTH,
                    headers: {
                        'Authorization': 'Basic ' + this.config.access_token,
                        'User-Agent': NestEndpoints.USER_AGENT_STRING,
                        'cookie': 'G_ENABLED_IDPS=google; eu_cookie_accepted=1; viewer-volume=0.5; cztoken=' + this.config.access_token
                    }
                };
            } else if (!this.config.googleAuth && !this.config.authenticator) {
                this.error('Nest account login by username/password is no longer supported.');
                return false;

                // eslint-disable-next-line
                this.debug('Authenticating via Nest account.');

                if (this.config.recaptchaServer) {
                    req = {
                        method: 'GET',
                        timeout: 3 * API_TIMEOUT_SECONDS * 1000,
                        url: this.config.recaptchaServer,
                        // json: true
                    };
                    let result;
                    try {
                        result = (await axios(req)).data;
                        if (result.status != 'OK' || !result.token || !result.key) {
                            this.debug('Recaptcha service failed:', result);
                        } else {
                            rcToken = result.token;
                            rcKey = result.key;
                        }
                    } catch (error) {
                        // We handle this later
                    }
                }

                req = {
                    method: 'POST',
                    // followAllRedirects: true,
                    timeout: API_TIMEOUT_SECONDS * 1000,
                    url: NestEndpoints.URL_NEST_AUTH,
                    headers: {
                        'User-Agent': NestEndpoints.USER_AGENT_STRING,
                        'content-Type': 'application/json',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache',
                        'Cookie': 'viewer-volume=0.5; _ga=GA1.2.1817575647.1579652723; _gid=GA1.2.18799290.1579652723; _gaexp=GAX1.2.BcN0_xGpR72iDpx328dA9A.18291.1; G_ENABLED_IDPS=google; _gat_UA-19609914-2=1',
                        'Host': NestEndpoints.NEST_API_HOSTNAME,
                        'hostname': NestEndpoints.NEST_API_HOSTNAME,
                        'Origin': 'https://' + NestEndpoints.NEST_API_HOSTNAME,
                        'Referer': 'https://' + NestEndpoints.NEST_API_HOSTNAME + '/',
                        'Sec-Fetch-Mode': 'cors',
                        'Sec-Fetch-Site': 'same-origin',
                        'x-no-cookies': 'true'
                    },
                    data: {
                        email: this.config.email,
                        password: this.config.password,
                        recaptcha: {
                            token: rcToken,
                            site_key: rcKey
                        }
                    }
                };
            } else {
                return false;
            }

            try {
                if (!this.config.authenticator && !this.config.googleAuth && !this.config.access_token && (!rcToken || !rcKey)) {
                    // Recaptcha failed - throw
                    throw({code: 'ENORECAPTCHA'});
                }
                body = (await axios(req)).data;
                this.connected = true;
                this.token = body.access_token;
                this.transport_url = body.urls.transport_url;
                this.userid = body.userid;
                this.connectionFailures = 0;
                this.debug('Authentication successful.');
            } catch (error) {
                error.status = error.response && error.response.status;
                if (error.status == 401 && error.response && error.response.data && error.response.data.truncated_phone_number) {
                    // 2FA required
                    let getPIN;

                    this.log('Your Nest account has 2-factor authentication enabled.');
                    if (this.config.pin) {
                        this.log('Using PIN ' + this.config.pin + ' from config.json.');
                        this.log('If authentication fails, check this matches the 6-digit PIN sent to your phone number ending ' + error.response.data.truncated_phone_number + '.');
                        getPIN = Promise.resolve(this.config.pin);
                    } else {
                        this.log('Please enter the 6-digit PIN sent to your phone number ending ' + error.response.data.truncated_phone_number + '.');
                        getPIN = Prompt('PIN: ');
                    }
                    try {
                        let pin = await getPIN;
                        let result = (await axios({
                            method: 'POST',
                            // followAllRedirects: true,
                            timeout: API_TIMEOUT_SECONDS * 1000,
                            url: NestEndpoints.URL_NEST_VERIFY_PIN,
                            data: {
                                pin: pin,
                                '2fa_token': error.response.data['2fa_token'],
                                'cookie': 'G_ENABLED_IDPS=google; eu_cookie_accepted=1; viewer-volume=0.5'
                            }
                        })).data;
                        body = (await axios({
                            method: 'GET',
                            // followAllRedirects: true,
                            timeout: API_TIMEOUT_SECONDS * 1000,
                            url: NestEndpoints.URL_NEST_AUTH,
                            headers: {
                                'Authorization': 'Basic ' + result.access_token,
                                'User-Agent': NestEndpoints.USER_AGENT_STRING,
                                'cookie': 'G_ENABLED_IDPS=google; eu_cookie_accepted=1; viewer-volume=0.5; cztoken=' + result.access_token
                            }
                        })).data;
                        this.connected = true;
                        this.token = body.access_token;
                        this.transport_url = body.urls.transport_url;
                        this.userid = body.userid;
                        return true; // resolve(true);
                    } catch (error) {
                        this.error('Auth failed: 2FA PIN was rejected');
                        return false; // resolve(false);
                    }
                } else if (error.status == 400) {
                    if (this.config.access_token) {
                        this.error('Auth failed: access token specified in Homebridge configuration rejected');
                    } else {
                        this.error('Auth failed: Nest rejected the account email/password specified in your Homebridge configuration file. Please check');
                        this.connectionFailures++;
                        if (this.connectionFailures >= 6) {
                            this.error('Too many failed auth attempts, waiting ' + API_AUTH_FAIL_RETRY_LONG_DELAY_SECONDS + ' seconds');
                            await Promise.delay(API_AUTH_FAIL_RETRY_LONG_DELAY_SECONDS * 1000);
                        }
                        continue;
                        // return await this.auth();
                    }
                    return false; // resolve(false);
                } else if (error.status == 429) {
                    this.error('Auth failed: rate limit exceeded. Please try again in 60 minutes');
                    return false; // resolve(false);
                } else {
                    console.log(error);
                    this.error('Could not authenticate with Nest (code ' + (error.status || error.code) + '). Retrying in ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' second(s).');
                    await Promise.delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000);
                    return await this.auth(); // .then(() => this.auth()).then(connected => resolve(connected));
                }
            }

            let isGoogle = this.config.googleAuth || this.config.authenticator;
            // Google tokens expire after 60 minutes (Nest is 30 days), so refresh just before that to make sure we always have a fresh token
            if (this.preemptiveReauthTimer) {
                clearTimeout(this.preemptiveReauthTimer);
            }
            this.preemptiveReauthTimer = setTimeout(() => {
                this.debug('Initiating pre-emptive reauthentication.');
                this.auth(true).catch(() => {
                    this.debug('Pre-emptive reauthentication failed.');
                });
            }, (isGoogle ? API_GOOGLE_REAUTH_MINUTES : API_NEST_REAUTH_MINUTES) * 60 * 1000);

            this.associatedStreamers.forEach(streamer => {
                try {
                    streamer.onTheFlyReauthorize();
                } catch (error) {
                    this.verbose('Warning: attempting to reauthorize with expired streamer', streamer);
                }
            });

            return true;
        }
    }

    mergePendingUpdates(unmergedBody) {
        let body = cloneObject(unmergedBody);

        this.mergeUpdates.forEach(update => {
            let expiryTime = update.expiry_time;
            let obj = update.object;

            if (expiryTime > Date.now()) {
                let deviceType = obj.object_key.split('.')[0];
                let deviceId = obj.object_key.split('.')[1];
                for (const key in obj.value) {
                    if (body[deviceType] && body[deviceType][deviceId]) {
                        this.verbose(deviceType + '.' + deviceId + '/' + key + ': overriding', body[deviceType][deviceId][key], '->', obj.value[key]);
                        body[deviceType][deviceId][key] = obj.value[key];
                    }
                }
            }
        });

        return body;
    }

    updateData() {
        let uri =  this.objectList.objects.length ? this.transport_url + NestEndpoints.ENDPOINT_SUBSCRIBE : 'https://' + NestEndpoints.NEST_API_HOSTNAME + '/api/0.1/user/' + this.userid + '/app_launch';
        let body = this.objectList.objects.length ? removeSubscribeObjectValues(this.objectList) : {'known_bucket_types':['buckets','structure','shared','topaz','device','rcs_settings','kryptonite','quartz','track','where'],'known_bucket_versions':[]};

        if (!this.token || !this.connected) {
            this.verbose('API subscribe deferred as not connected to Nest.');
            return Promise.delay(API_RETRY_DELAY_SECONDS * 1000).then(() => { return null; });
        }

        this.verbose('API subscribe POST: ' + (this.objectList.objects.length ? 'subscribing' : 'app launch'));
        return axios({
            method: 'POST',
            // followAllRedirects: true,
            timeout: API_SUBSCRIBE_TIMEOUT_SECONDS * 1000,
            url: uri,
            headers: {
                'User-Agent': NestEndpoints.USER_AGENT_STRING,
                'Authorization': 'Basic ' + this.token,
                'X-nl-user-id': this.userid,
                'X-nl-protocol-version': 1
            },
            data: body
        }).then(rawBody => {
            let body = this.mergePendingUpdates(this.createNestBody(this.currentState, rawBody.data.updated_buckets || rawBody.data.objects, this.objectList));
            return this.apiResponseToObjectTree(body);
        });
    }

    updateProtobufData(resolve, handler) {
        var notify;
        let protoBuffer = Buffer.alloc(0);
        let pendingLength = 0;

        function isEmptyObject(obj) {
            for (const prop in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, prop)) {
                    return false;
                }
            }
            return true;
        }

        return new Promise((res, rej) => {
            if (!this.token || !this.connected) {
                this.verbose('API observe deferred as not connected to Nest.');
                return Promise.delay(API_RETRY_DELAY_SECONDS * 1000).then(res);
            }

            let protodata = fs.readFileSync(__dirname + '/protobuf/ObserveTraits.protobuf', null);

            this.verbose('API observe POST: issuing');

            if (this.cancelObserve) {
                this.verbose('API observe cancelled as initiating new call.');
                try {
                    this.cancelObserve();
                } catch (error) {
                    // Ignore
                }
            }

            this.cancelObserve = null;
            this.cancelObserveTimer = setInterval(() => {
                if ((!this.token || !this.connected) && this.cancelObserve) {
                    this.verbose('API observe cancelled as not connected to Nest.');
                    try {
                        this.cancelObserve();
                    } catch (error) {
                        // Ignore
                    }
                }
            }, 1000);

            let client = http2.connect(NestEndpoints.URL_PROTOBUF, { maxOutstandingPings: 10 });
            client.on('error', error => {
                this.verbose('API observe POST: client error', error);
                rej(error);
            });

            client.on('stream', () => {
                this.verbose('API observe POST: new stream');
            });

            client.on('ping', payload => {
                this.verbose('API observe POST: incoming ping', payload.toString('base64'));
            });

            /* this.observePingTimer = setInterval(() => {
                client.ping((err, duration, payload) => {
                    console.log('API observe PING:', duration, payload, err);
                    if (!client.connecting && !client.closed && err) {
                        clearInterval(this.observePingTimer);
                        client.destroy();
                    }
                });
            }, 20000); */

            client.on('close', () => {
                this.verbose('API observe POST: stream ended');
                clearInterval(this.cancelObserveTimer);
                this.cancelObserve = null;
                // clearInterval(this.observePingTimer);
                // this.observePingTimer = null;
                res();
            });

            // API_OBSERVE_TIMEOUT_SECONDS
            client.setTimeout(API_OBSERVE_TIMEOUT_SECONDS * 1000, () => {
                this.verbose('API observe POST: stream timed out');
                client.destroy();
            });

            let req = client.request({
                ':method': 'POST',
                ':path': NestEndpoints.ENDPOINT_OBSERVE,
                'User-Agent': NestEndpoints.USER_AGENT_STRING,
                'Content-Type': 'application/x-protobuf',
                'X-Accept-Content-Transfer-Encoding': 'binary',
                'X-Accept-Response-Streaming': 'true',
                'Authorization': 'Basic ' + this.token,
                'request-id': uuidv4(),
                'referer': 'https://home.nest.com/',
                'origin': 'https://home.nest.com',
                'x-nl-webapp-version': 'NlAppSDKVersion/8.15.0 NlSchemaVersion/2.1.20-87-gce5742894'
            });

            req.write(protodata);
            req.end();

            // this.cancelObserve = () => req.close(http2.constants.NGHTTP2_CANCEL);
            this.cancelObserve = () => {
                req.close(http2.constants.NGHTTP2_CANCEL);
                client.destroy();
            };

            /* req.on('response', (headers, flags) => {
                for (const name in headers) {
                    console.log(`${name}: ${headers[name]}`);
                }
            }); */

            req.on('data', data => {
                if (protoBuffer.length == 0) {
                    // Start of protobuf
                    pendingLength = varint.decode(data, 1);
                    pendingLength += varint.decode.bytes + 1;
                }
                protoBuffer = Buffer.concat([protoBuffer, data]);
                // this.verbose('API observe POST: data received, length ' + data.length + ' (-> ' + protoBuffer.length + '/' + pendingLength + ')');
                if (protoBuffer.length >= pendingLength) {
                    let protoMessage = protoBuffer.slice(0, pendingLength);
                    protoBuffer = protoBuffer.slice(pendingLength);
                    this.verbose('API observe POST: complete message received (' + pendingLength + ')');
                    if (protoBuffer.length > 0) {
                        pendingLength = varint.decode(protoBuffer, 1);
                        pendingLength += varint.decode.bytes + 1;
                    }
                    let observeMessage = this.protobufToNestLegacy(protoMessage);
                    this.protobufBody = observeMessage.body;
                    if (notify || observeMessage.hasDeviceInfo) {
                        if (!isEmptyObject(this.protobufBody)) {
                            let body = this.mergePendingUpdates(this.mergeNestWithProtobufData(this.currentState, this.protobufBody));
                            let notifyFunction = notify || resolve || handler;
                            notifyFunction(this.apiResponseToObjectTree(body));
                            notify = handler;
                        }
                    }
                }
            });
            req.on('error', (error) => {
                this.verbose('API observe POST: stream error', error);
                rej(error);
            });
        });
    }

    protobufToNestLegacy(protobuf) {
        function checkDeviceExists(body, deviceId) {
            if ((body.device && body.device[deviceId] && body.shared && body.shared[deviceId]) || (body.topaz && body.topaz[deviceId]) || (body.kryptonite && body.kryptonite[deviceId]) || (body.yale && body.yale[deviceId]) || (body.guard && body.guard[deviceId]) || (body.detect && body.detect[deviceId])) {
                return true;
            } else {
                // this.verbose('Warning: trying to set property for unmounted device ' + deviceId);
                return false;
            }
        }

        function translateProperty(object, propName, constructor, enumerator) {
            let propObjects = getProtoObject(object, propName);
            if (propObjects) {
                // console.log('(Found', propObjects.length, 'objects matching', propName + ')');
                if (constructor) {
                    constructor();
                }
                propObjects.forEach(propObject => {
                    try {
                        enumerator(propObject, toLegacy(propObject.object.id));
                    } catch(error) {
                        console.log('Warning: error enumerating property', propName + '@' + propObject.object.id);
                    }
                });
            }
        }

        function toLegacy(id) {
            return id.split('_')[1];
        }

        function initDevice(self, deviceType, deviceId, structureId, fwVersion, body) {
            self.legacyDeviceMap[deviceId] = deviceType;
            if (!body[deviceType]) {
                body[deviceType] = {};
            }

            body[deviceType][deviceId] = {};

            body[deviceType][deviceId].using_protobuf = true;
            body[deviceType][deviceId].device_id = deviceId;
            body[deviceType][deviceId].structure_id = structureId;
            body[deviceType][deviceId].current_version = fwVersion;
            body[deviceType][deviceId].user_id = self.protobufUserId;

            if (!body.structure[structureId].swarm) {
                body.structure[structureId].swarm = [ ];
            }
            body.structure[structureId].swarm.push(deviceType + '.' + deviceId);
        }

        let body = this.protobufBody, message, object;
        let hasDeviceInfo = false;

        try {
            message = this.StreamBody.decode(protobuf);
            object = this.StreamBody.toObject(message, { enums: String, defaults: true });
        } catch(error) {
            // Not a Nest device info object
            return { body: body, hasDeviceInfo: false };
        }
        try {
            if (object.status) {
                this.verbose('object.status', object.status);
                this.lastProtobufCode = object.status;
            } else {
                this.lastProtobufCode = null;
            }
            if (object && object.message && object.message.length > 0) {
                this.verbose('Protobuf message object length', object.message.length);
                object = object.message[0].get;
                if (object) {
                    transformTraits(object, this.proto);

                    let keyList = getProtoKeys(object);
                    this.verbose('Protobuf updated properties:', keyList.map(el => el[0] + '@' + el[1] + ' (' + el[2] + ')').join(', '));

                    translateProperty(object, 'user_info', null, userInfo => {
                        this.verbose('Legacy user mapping', userInfo.object.id, '->', userInfo.data.property.value.legacyId);
                        this.protobufUserId = userInfo.object.id;
                        hasDeviceInfo = true;
                    });

                    translateProperty(object, 'structure_info', () => {
                        if (!body.structure) {
                            body.structure = {};
                        }
                    }, (el, id) => {
                        let structureId = el.data.property.value.legacyId.split('.')[1];
                        body.structure[structureId] = {
                            structure_id: structureId,
                            new_structure_id: id,
                            user_id: this.protobufUserId,
                            using_protobuf: true
                        };
                        this.legacyStructureMap[id] = structureId;
                    });

                    translateProperty(object, 'located_annotations', () => {
                        if (!body.where) {
                            body.where = {};
                        }
                    }, (el, id) => {
                        let structureId = this.legacyStructureMap[id];
                        if (structureId) {
                            body.where[structureId] = { wheres: [] };
                            (el.data.property.value.annotations || []).forEach(el => {
                                body.where[structureId].wheres.push({
                                    where_id: el.info.id.value,
                                    name: el.info.name.value
                                });
                            });
                            (el.data.property.value.customAnnotations || []).forEach(el => {
                                body.where[structureId].wheres.push({
                                    where_id: el.info.id.value,
                                    name: el.info.name.value
                                });
                            });
                        }
                    });

                    translateProperty(object, 'liveness', null, (liveness, id) => {
                        this.verbose('Liveness', id, '->', liveness.data.property.value.status);
                        // if (checkDeviceExists(body, id)) {
                        if (!body.track) {
                            body.track = {};
                        }
                        body.track[id] = { online: liveness.data.property.value.status == 'LIVENESS_DEVICE_STATUS_ONLINE' };
                        // }
                    });

                    translateProperty(object, 'peer_devices', null, (peerDevice, id) => {
                        // console.log('peer_devices', id);
                        let structureId = this.legacyStructureMap[id];
                        if (!peerDevice.object.id.startsWith('STRUCTURE_')) {
                            // Continue
                        } else if (!structureId) {
                            this.debug('Cannot determine legacy structure ID for new ID', id);
                        } else {
                            // console.log(peerDevice);
                            let oldMountedDeviceCount = cloneObject(this.mountedDeviceCount);
                            this.mountedDeviceCount.protobuf[structureId] = peerDevice.data.property.value.devices.length;
                            this.verbose('Protobuf API: structure ' + structureId + ', found', this.mountedDeviceCount.protobuf[structureId], 'device(s)');
                            if (oldMountedDeviceCount.protobuf[structureId] !== undefined && oldMountedDeviceCount.protobuf[structureId] !== this.mountedDeviceCount.protobuf[structureId]) {
                                this.verbose('Protobuf API: found device count for structure', structureId, 'has changed (protobuf):', oldMountedDeviceCount.protobuf[structureId], '->', this.mountedDeviceCount.protobuf[structureId]);
                                if (this.config.exitOnDeviceListChanged) {
                                    process.exit(1);
                                }
                            }
                            peerDevice.data.property.value.devices.forEach(el => {
                                // console.log('device', el);

                                let deviceId = toLegacy(el.data.deviceId.value);
                                let deviceType = el.data.deviceType.value;
                                this.verbose('Found device ' + el.data.deviceId.value + '@' + deviceType);

                                if (body.track && body.track[deviceId] && !body.track[deviceId].online) {
                                    this.verbose('----> ignoring as unreachable');
                                } else if (['nest.resource.NestLearningThermostat3Resource', 'nest.resource.NestAgateDisplayResource', 'nest.resource.NestOnyxResource'].includes(deviceType)) {
                                    // Nest Learning Thermostat 3rd Generation, Thermostat E with Heat Link, 1st Gen US Thermostat E
                                    this.verbose('----> mounting as Nest Thermostat');
                                    initDevice(this, 'device', deviceId, structureId, el.data.fwVersion, body);

                                    if (!body.shared) {
                                        body.shared = {};
                                    }
                                    body.shared[deviceId] = {};
                                } else if (deviceType == 'nest.resource.NestKryptoniteResource') {
                                    // Nest Temperature Sensor
                                    this.verbose('----> mounting as Nest Temperature Sensor');
                                    initDevice(this, 'kryptonite', deviceId, structureId, el.data.fwVersion, body);
                                } else if (deviceType == 'yale.resource.LinusLockResource') {
                                    // Nest x Yale Lock
                                    this.verbose('----> mounting as Nest x Yale Lock');
                                    initDevice(this, 'yale', deviceId, structureId, el.data.fwVersion, body);
                                } else if (deviceType == 'nest.resource.NestGuardResource') {
                                    // Nest Guard
                                    this.verbose('----> mounting as Nest Guard');
                                    initDevice(this, 'guard', deviceId, structureId, el.data.fwVersion, body);
                                    body.guard[deviceId].security_issues = [];
                                } else if (deviceType == 'nest.resource.NestDetectResource') {
                                    // Nest Detect
                                    this.verbose('----> mounting as Nest Detect');
                                    initDevice(this, 'detect', deviceId, structureId, el.data.fwVersion, body);
                                } else {
                                    this.verbose('----> ignoring as currently unsupported type');
                                } /* else if (deviceType == 'nest.resource.NestProtect2LinePoweredResource' || deviceType == 'nest.resource.NestProtect2BatteryPoweredResource') {

                                // Protobuf API support for Nest Protects will come later. Right now, it doesn't appear as though
                                // any Nest Protects are exclusively on the protobuf API - although this is likely to change in
                                // the future.

                                this.legacyDeviceMap[deviceId] = 'topaz';
                                if (!body.topaz) {
                                    body.topaz = {};
                                }

                                body.topaz[deviceId] = {};
                                body.topaz[deviceId].using_protobuf = true;
                                body.topaz[deviceId].device_id = deviceId;
                                body.topaz[deviceId].structure_id = structureId;
                                body.topaz[deviceId].current_version = el.data.fwVersion;

                                if (!body.structure[structureId].swarm) {
                                    body.structure[structureId].swarm = [ ];
                                }
                                body.structure[structureId].swarm.push('topaz.' + deviceId);
                            } */
                            });
                        }
                    });

                    translateProperty(object, 'device_located_settings', null, (deviceLocatedSetting, id) => {
                        // console.log('device_located_settings', id);
                        if (checkDeviceExists(body, id) && deviceLocatedSetting.data.property.value.whereId) {
                            let deviceKey = this.legacyDeviceMap[id];
                            body[deviceKey][id].where_id = deviceLocatedSetting.data.property.value.whereId.value;
                            body[deviceKey][id].fixture_type = deviceLocatedSetting.data.property.value.fixtureType && deviceLocatedSetting.data.property.value.fixtureType.majorType;
                        }
                    });

                    translateProperty(object, 'device_identity', null, (deviceIdentity, id) => {
                        // console.log('device_identity', id, deviceIdentity.data.property.value);
                        if (checkDeviceExists(body, id)) {
                            let deviceKey = this.legacyDeviceMap[id];
                            body[deviceKey][id][deviceKey == 'topaz' ? 'model' : 'model_name'] = deviceIdentity.data.property.value.modelName && deviceIdentity.data.property.value.modelName.value;
                            body[deviceKey][id].serial_number = deviceIdentity.data.property.value.serialNumber;
                            body[deviceKey][id].current_version = deviceIdentity.data.property.value.fwVersion;
                        }
                    });

                    translateProperty(object, 'hvac_equipment_capabilities', null, (hvacEquipmentCapability, id) => {
                        // console.log('hvac_equipment_capabilities', id);
                        if (checkDeviceExists(body, id)) {
                            body.device[id].can_heat = !!hvacEquipmentCapability.data.property.value.canHeat;
                            body.device[id].can_cool = !!hvacEquipmentCapability.data.property.value.canCool;
                        }
                    });

                    translateProperty(object, 'hvac_control', null, (hvacControl, id) => {
                        // console.log('hvac_control', id, JSON.stringify(hvacControl, null, 2));
                        if (checkDeviceExists(body, id)) {
                            body.device[id].hvac_heater_state = !!hvacControl.data.property.value.settings.isHeating;
                            body.device[id].hvac_ac_state = !!hvacControl.data.property.value.settings.isCooling;
                        }
                    });

                    translateProperty(object, 'target_temperature_settings', null, (targetTemperatureSetting, id) => {
                        if (checkDeviceExists(body, id)) {
                            let hvac_mode = !targetTemperatureSetting.data.property.value.active.value ? 'off' : targetTemperatureSetting.data.property.value.settings.hvacMode.toLowerCase();
                            body.shared[id].target_temperature_type = hvac_mode;
                            body.shared[id].target_temperature_low = targetTemperatureSetting.data.property.value.settings.targetTemperatureHeat.value;
                            body.shared[id].target_temperature_high = targetTemperatureSetting.data.property.value.settings.targetTemperatureCool.value;
                            if (hvac_mode == 'heat') {
                                body.shared[id].target_temperature = body.shared[id].target_temperature_low;
                            } else if (hvac_mode == 'cool') {
                                body.shared[id].target_temperature = body.shared[id].target_temperature_high;
                            } else {
                                body.shared[id].target_temperature = 0.5 * (body.shared[id].target_temperature_high + body.shared[id].target_temperature_low);
                            }
                        }
                    });

                    translateProperty(object, 'fan_control_settings', null, (fanControlSetting, id) => {
                        if (checkDeviceExists(body, id)) {
                            body.device[id].has_fan = true;
                            body.device[id].fan_timer_active = fanControlSetting.data.property.value.fanTimerTimeout && fanControlSetting.data.property.value.fanTimerTimeout.value;
                            body.device[id].fan_timer_timeout = body.device[id].fan_timer_active ? fanControlSetting.data.property.value.fanTimerTimeout.value : 0;
                            body.device[id].fan_timer_duration = body.device[id].fan_timer_active ? fanControlSetting.data.property.value.fanTimerTimeout.value - Date.now() : 0;

                            // Protobuf-only fan properties
                            body.device[id].fan_mode_protobuf = fanControlSetting.data.property.value.mode;
                            body.device[id].fan_hvac_override_speed_protobuf = fanControlSetting.data.property.value.hvacOverrideSpeed;
                            body.device[id].fan_schedule_speed_protobuf = fanControlSetting.data.property.value.scheduleSpeed;
                            body.device[id].fan_schedule_duty_cycle_protobuf = fanControlSetting.data.property.value.scheduleDutyCycle;
                            body.device[id].fan_schedule_start_time_protobuf = fanControlSetting.data.property.value.scheduleStartTime;
                            body.device[id].fan_schedule_end_time_protobuf = fanControlSetting.data.property.value.scheduleEndTime;
                            body.device[id].fan_timer_speed_protobuf = fanControlSetting.data.property.value.timerSpeed;
                        }
                    });

                    translateProperty(object, 'eco_mode_state', null, (ecoModeState, id) => {
                        if (checkDeviceExists(body, id)) {
                            body.device[id].eco = { mode: ecoModeState.data.property.value.ecoEnabled == 'OFF' ? 'schedule' : 'manual-eco' };
                        }
                    });

                    translateProperty(object, 'eco_mode_settings', null, (ecoModeSetting, id) => {
                        if (checkDeviceExists(body, id)) {
                            body.device[id].auto_away_enable = !!ecoModeSetting.data.property.value.autoEcoEnabled;
                            body.device[id].away_temperature_low = ecoModeSetting.data.property.value.low.temperature.value;
                            body.device[id].away_temperature_low_enabled = !!ecoModeSetting.data.property.value.low.enabled;
                            body.device[id].away_temperature_high = ecoModeSetting.data.property.value.high.temperature.value;
                            body.device[id].away_temperature_high_enabled = !!ecoModeSetting.data.property.value.high.enabled;
                        }
                    });

                    translateProperty(object, 'display_settings', null, (displaySetting, id) => {
                        if (checkDeviceExists(body, id)) {
                            body.device[id].temperature_scale = displaySetting.data.property.value.units == 'DEGREES_F' ? 'F' : 'C';
                        }
                    });

                    translateProperty(object, 'remote_comfort_sensing_settings', null, (rcsSetting, id) => {
                        // console.log(JSON.stringify(rcsSetting, null, 2));
                        if (checkDeviceExists(body, id)) {
                            let rcsSensors = [];
                            try {
                                rcsSensors = rcsSetting.data.property.value.associatedRcsSensors.map(el => el.deviceId && el.deviceId.resourceId).map(el => 'kryptonite.' + el.split('_')[1]);
                            } catch(error) {
                                // Ignore if can't get RCS sensors
                            }
                            if (!body.rcs_settings) {
                                body.rcs_settings = {};
                            }
                            // console.log('rcsSensors', rcsSensors);
                            body.rcs_settings[id] = { associated_rcs_sensors: rcsSensors };
                        }
                    });

                    translateProperty(object, 'backplate_temperature', null, (backplateTemperature, id) => {
                        if (checkDeviceExists(body, id)) {
                            body.device[id].backplate_temperature = backplateTemperature.data.property.value.temperature.value.value;
                        }
                    });

                    translateProperty(object, 'current_temperature', null, (currentTemperature, id) => {
                        let deviceKey = this.legacyDeviceMap[id];
                        if (checkDeviceExists(body, id)) {
                            body[deviceKey][id].current_temperature = currentTemperature.data.property.value.temperature.value.value;
                        }
                    });

                    translateProperty(object, 'current_humidity', null, (currentHumidity, id) => {
                        if (checkDeviceExists(body, id)) {
                            body.device[id].current_humidity = currentHumidity.data.property.value.humidity.value.value;
                        }
                    });

                    translateProperty(object, 'bolt_lock', null, (boltLock, id) => {
                        if (checkDeviceExists(body, id)) {
                            body.yale[id].bolt_locked = (boltLock.data.property.value.lockedState == 'BOLT_LOCKED_STATE_LOCKED');
                            body.yale[id].bolt_moving = (boltLock.data.property.value.actuatorState != 'BOLT_ACTUATOR_STATE_OK');
                            body.yale[id].bolt_moving_to = (boltLock.data.property.value.actuatorState == 'BOLT_ACTUATOR_STATE_LOCKING');
                            this.verbose('Protobuf lock state updated:', boltLock.data.property.value.actuatorState, boltLock.data.property.value.lockedState);
                        }
                    });

                    translateProperty(object, 'battery', null, (batteryStatus, id) => {
                        let deviceKey = this.legacyDeviceMap[id];
                        if (checkDeviceExists(body, id)) {
                            body[deviceKey][id].battery_status = batteryStatus.data.property.value.replacementIndicator;
                            body[deviceKey][id].battery_voltage = batteryStatus.data.property.value.assessedVoltage && batteryStatus.data.property.value.assessedVoltage.value;
                        }
                    });
                }
            }
        } catch(error) {
            this.verbose('Protobuf decode error:', error);
        }

        /* if (hasDeviceInfo) {
            console.log('***', JSON.stringify(body, null, 2));
        } */
        return { body: body, hasDeviceInfo: hasDeviceInfo };
    }

    apiResponseToObjectTree(body) {
        let data = {};
        data.devices = {};
        data.devices['thermostats'] = {};
        data.devices['home_away_sensors'] = {};
        data.devices['temp_sensors'] = {};
        data.devices['smoke_co_alarms'] = {};
        data.devices['cameras'] = {};
        data.devices['locks'] = {};
        data.devices['guards'] = {};
        data.devices['detects'] = {};

        let structures = body.structure || {};
        let shared = body.shared || {};
        let topaz = body.topaz || {};
        let device = body.device || {};
        let rcs_settings = body.rcs_settings || {};
        let kryptonite = body.kryptonite || {};
        let track = body.track || {};
        let yale = body.yale || {};

        for (const structureId in structures) {
            let thisStructure = structures[structureId];

            let whereLookup = {};
            if (body.where[structureId]) {
                let wheres = body.where[structureId].wheres || {};
                wheres.forEach(where => whereLookup[where.where_id] = where.name);
            }

            thisStructure.structure_id = structureId;

            // Set up home/away sensor
            data.devices['home_away_sensors'][structureId] = {};
            data.devices['home_away_sensors'][structureId].structure_id = structureId;
            data.devices['home_away_sensors'][structureId].device_id = structureId;
            data.devices['home_away_sensors'][structureId].software_version = null;
            data.devices['home_away_sensors'][structureId].serial_number = structureId;
            if (Object.keys(structures).length > 1) {
                data.devices['home_away_sensors'][structureId].name = 'Home Occupied - ' + thisStructure.name;
            } else {
                data.devices['home_away_sensors'][structureId].name = 'Home Occupied';
            }
            data.devices['home_away_sensors'][structureId].model = 'Home/Away Control';
            data.devices['home_away_sensors'][structureId].away = thisStructure.away;

            let swarm = thisStructure.swarm;
            swarm.map(unit => unit.split('.')).forEach(unit => {
                let deviceType = unit[0];
                let deviceId = unit[1];

                if (deviceType == 'device') {
                    // Detected thermostat

                    data.devices['thermostats'][deviceId] = device[deviceId];
                    let thisDevice = data.devices['thermostats'][deviceId];

                    for (const sKey in shared[deviceId]) {
                        thisDevice[sKey] = shared[deviceId][sKey];
                    }

                    thisDevice.uses_heat_link = !!thisDevice.heat_link_connection;
                    if (thisDevice.uses_heat_link) {
                        // EU/UK Heat Link thermostats use some slightly different fields, and support heat mode only
                        if (thisDevice.target_temperature_type === undefined) {
                            thisDevice.target_temperature_type = (thisDevice.maint_band_lower == 0) ? 'OFF' : 'HEAT';
                        }
                        if (thisDevice.hvac_heater_state === undefined) {
                            thisDevice.hvac_heater_state = !thisDevice.leaf;
                        }
                        thisDevice.can_heat = true;
                        thisDevice.can_cool = false;
                    }
                    thisDevice.device_id = deviceId;
                    thisDevice.structure_id = structureId;
                    thisDevice.where_name = whereLookup[thisDevice.where_id];
                    thisDevice.name = (thisDevice.name || thisDevice.where_name || 'Nest') + ' Thermostat';
                    thisDevice.fan_timer_active = (thisDevice.fan_timer_timeout > 0) || thisDevice.hvac_fan_state;
                    thisDevice.previous_hvac_mode = thisDevice.target_temperature_type.toLowerCase();
                    thisDevice.has_eco_mode = !!thisDevice.eco;
                    if (thisDevice.has_eco_mode) {
                        thisDevice.hvac_mode = (thisDevice.eco.mode == 'manual-eco' || thisDevice.eco.mode == 'auto-eco') ? 'eco' : thisDevice.previous_hvac_mode;
                    } else {
                        thisDevice.hvac_mode = thisDevice.previous_hvac_mode;
                    }
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
                                    temperature_scale: thisDevice.temperature_scale,
                                    battery_voltage: thisSensor.battery_level ? (thisSensor.battery_level > 66 ? 3 : 2.5) : 0,
                                    using_protobuf: thisSensor.using_protobuf
                                };
                                thisDevice.has_temperature_sensors = true;
                            }
                        });
                    }
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
                    /* if (Object.keys(data.devices['home_away_sensors']).length == 0) {
                        data.devices['home_away_sensors'][structureId] = {};
                        data.devices['home_away_sensors'][structureId].structure_id = structureId;
                        data.devices['home_away_sensors'][structureId].device_id = structureId;
                        data.devices['home_away_sensors'][structureId].software_version = thisDevice.software_version;
                        data.devices['home_away_sensors'][structureId].serial_number = thisDevice.serial_number;
                        data.devices['home_away_sensors'][structureId].name = 'Home/Away';
                        data.devices['home_away_sensors'][structureId].model = thisDevice.where_name;
                        data.devices['home_away_sensors'][structureId].away = thisDevice.topaz_away;
                    } */
                    /* } else if (deviceType == 'quartz') {
                        // Detected Nest Cam

                        data.devices['cameras'][deviceId] = quartz[deviceId];
                        let thisDevice = data.devices['cameras'][deviceId];
                        thisDevice.device_id = deviceId;
                        thisDevice.where_name = whereLookup[thisDevice.where_id];
                        thisDevice.name = thisDevice.description || thisDevice.where_name || 'Nest Camera'; */
                } else if (deviceType == 'yale') {
                    // Detected Nest x Yale Lock

                    data.devices['locks'][deviceId] = yale[deviceId];
                    let thisDevice = data.devices['locks'][deviceId];
                    thisDevice.device_id = deviceId;
                    thisDevice.software_version = thisDevice.current_version;
                    thisDevice.where_name = whereLookup[thisDevice.where_id];
                    thisDevice.name = (thisDevice.description || thisDevice.where_name || 'Nest x Yale') + ' Lock';
                }
            });
        }

        data.structures = structures;
        return data;
    }

    dataTimerLoop(resolve, handler) {
        var notify = resolve || handler;
        var apiLoopTimer;

        this.updateData().then(data => {
            if (data) {
                this.verbose('API subscribe GET: got updated data');
                notify(data);
            }
        }).catch(error => {
            error.status = error.response && error.response.status;
            if (!['ESOCKETTIMEDOUT','ECONNABORTED'].includes(error.code)) {
                if (!error.status || error.status != 401) {
                    // 401 responses are normal when reauthentication is required - not actually a real "error"
                    this.error('Nest API call to subscribe to device settings updates returned an error: ' + (error.status || error.code || error));
                }
                if (error.status == 401 || error.status == 403 || ['ECONNREFUSED','ENETUNREACH'].includes(error.code)) {
                    // Token has probably expired, or transport endpoint has changed - re-authenticate
                    this.log('Reauthenticating on Nest service ...');
                    return this.auth().catch(() => {
                        this.log('Reauthentication failed, waiting for ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' seconds.');
                        return Promise.delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000);
                    });
                } else {
                    this.log('Retrying in ' + API_RETRY_DELAY_SECONDS + ' seconds.');
                    return Promise.delay(API_RETRY_DELAY_SECONDS * 1000);
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
    }

    protobufDataTimerLoop(resolve, handler) {
        var apiLoopTimer;

        this.verbose('API observe POST: streaming request initiated');
        this.updateProtobufData(resolve, handler).then(() => {
            this.verbose('API observe POST: streaming request concluded');
            // Token has probably expired, or transport endpoint has changed - re-authenticate
            // console.log(this.lastProtobufCode);
            // code 4: context timed out
            // code 7: invalid authentication
            // code 8: message quota exceeded
            // code 13: internal error encountered
            // code 14: socket closed / OS error
            if (this.lastProtobufCode && this.lastProtobufCode.code == 13) {
                this.error('API observe: internal error, waiting for ' + API_RETRY_DELAY_SECONDS + ' seconds, code', this.lastProtobufCode);
                return Promise.delay(API_RETRY_DELAY_SECONDS * 1000);
            } else if (this.lastProtobufCode && this.lastProtobufCode.code == 7) { // Was != 4
                this.log('Reauthenticating on Nest service ...');
                return this.auth().catch(() => {
                    this.log('Reauthentication failed, waiting for ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' seconds.');
                    return Promise.delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000);
                });
            } else {
                this.verbose('API observe: resolving null, code', this.lastProtobufCode);
                return Promise.resolve(null);
            }
        }).catch(error => {
            this.error('API observe: error', error);
            this.error('Retrying in ' + API_RETRY_DELAY_SECONDS + ' seconds.');
            return Promise.delay(API_RETRY_DELAY_SECONDS * 1000);
        }).finally(() => {
            this.verbose('API observe: setting issue timer.');
            apiLoopTimer = setInterval(() => {
                if (apiLoopTimer) {
                    clearInterval(apiLoopTimer);
                }
                this.protobufDataTimerLoop(null, handler);
            }, API_SUBSCRIBE_DELAY_SECONDS * 1000);
        });
    }

    subscribe(handler) {
        this.updateHomeKit = handler;
        return new Promise(resolve => {
            this.dataTimerLoop(resolve, handler);
        });
    }

    observe(handler) {
        return new Promise(resolve => {
            this.protobufDataTimerLoop(resolve, handler);
        });
    }

    update(device, property, value, hvac_mode, using_protobuf) {
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
                    this.commitUpdate('device.' + deviceId, { eco: { mode: 'schedule' } }, null, using_protobuf);
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
            } else if (property == 'hot_water_active') {
                body = { hot_water_active: value, hot_water_boost_time_to_end: value ? getUnixTime() + ((this.config.hotWaterDurationMinutes || DEFAULT_HOT_WATER_DURATION_MINUTES) * 60) : 0 };
            }
        }

        let nodeId = deviceType + '.' + deviceId;
        this.commitUpdate(nodeId, body, hvac_mode, using_protobuf);
        return Promise.resolve();
    }

    commitUpdate(nodeId, body, hvac_mode, using_protobuf) {
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
            this.updateHomeKit(this.apiResponseToObjectTree(this.currentState));
        }, API_MERGE_PENDING_MAX_SECONDS * 1000);

        if (body.target_temperature_type || body.eco || body.away) {
            // Changing mode -> push immediately
            this.pushUpdates([{ using_protobuf: using_protobuf, hvac_mode: hvac_mode, object: newApiObject }]);
            this.lastModeChangeTime = Date.now();
        } else {
            // Otherwise add to pending updates
            let updatingExistingKey = false;
            this.pendingUpdates.forEach(obj => {
                if (obj.object.object_key == nodeId) {
                    updatingExistingKey = true;
                    for (const key in body) {
                        obj.object.value[key] = cloneObject(body)[key];
                    }
                }
            });
            if (!updatingExistingKey) {
                this.pendingUpdates.push({ using_protobuf: using_protobuf, hvac_mode: hvac_mode, object: newApiObject });
            }
            this.pushUpdatesDebounced();
        }
    }

    mergeNestWithProtobufData(nestApiData, data) {
        // console.log('*** merging', JSON.stringify(nestApiData, null, 2), 'with', JSON.stringify(data, null, 2));

        for (const el in data) {
            if (typeof(data[el]) == 'object' && data[el] && !Array.isArray(data[el])) {
                if (!nestApiData[el]) {
                    nestApiData[el] = cloneObject(data[el]);
                } else {
                    nestApiData[el] = this.mergeNestWithProtobufData(nestApiData[el], data[el]);
                }
            } else if (Array.isArray(data[el])) {
                data[el].forEach(val => {
                    if (!nestApiData[el]) {
                        nestApiData[el] = {};
                    }
                    if (!nestApiData[el].includes(val)) {
                        nestApiData[el].push(val);
                    }
                });
            } else {
                nestApiData[el] = cloneObject(data[el]);
            }
        }

        return nestApiData;
    }

    protobufSendCommand(cmd, device_id, successResponse) {
        let protobufUpdates, el = { };

        if (cmd) {
            el.resourceCommands = cmd;
            el.resourceRequest = {
                resourceId: device_id,
                requestId: uuidv4()
            };
            this.verbose('-> Protobuf (Cmd) -', JSON.stringify(el, null, 2));

            let trait = lookupTrait(this.proto, el.resourceCommands[0].command.type_url);
            if (!trait) {
                this.verbose('Unable to find trait', el.resourceCommands[0].command.type_url);
            } else {
                el.resourceCommands[0].command.value = trait.encode(trait.fromObject(el.resourceCommands[0].command.value)).finish();
            }
        } else {
            return null;
        }

        /* let trait = lookupTrait(this.proto, el.property.type_url);
        if (!trait) {
            this.verbose('Unable to find trait', el.property.type_url);
        } else {
            el.property.value = trait.encode(trait.fromObject(el.property.value)).finish();
        } */

        // let encodedData = this.proto['nestlabs/gateway/v1'].lookupType('nestlabs.gateway.v1.ResourceCommandRequest').encode(this.proto['nestlabs/gateway/v1'].lookupType('nestlabs.gateway.v1.ResourceCommandRequest').fromObject(el)).finish();
        let encodedData = this.proto.root.lookupType('nestlabs.gateway.v1.ResourceCommandRequest').encode(this.proto.root.lookupType('nestlabs.gateway.v1.ResourceCommandRequest').fromObject(el)).finish();
        this.verbose('Send command request:', encodedData.toString('base64'));
        protobufUpdates = encodedData;

        return Promise.resolve(axios({
            method: 'POST',
            // followAllRedirects: true,
            url: NestEndpoints.URL_PROTOBUF + NestEndpoints.ENDPOINT_SENDCOMMAND,
            timeout: API_TIMEOUT_SECONDS * 1000,
            headers: {
                'User-Agent': NestEndpoints.USER_AGENT_STRING,
                'Authorization': 'Basic ' + this.token,
                'Content-Type': 'application/x-protobuf',
                'X-Accept-Content-Transfer-Encoding': 'binary',
                'X-Accept-Response-Streaming': 'true'
            },
            responseType: 'arraybuffer',
            data: protobufUpdates
        })).then(result => {
            let decodedData = this.proto.root.lookupType('nestlabs.gateway.v1.ResourceCommandResponseFromAPI').decode(result.data).toJSON();
            this.verbose('--> Command response:', JSON.stringify(decodedData, null, 2));

            if (!successResponse) {
                return result;
            } else {
                let operationSuccess = false;
                decodedData.resouceCommandResponse.forEach(response => {
                    response.traitOperations.forEach(operation => {
                        if (operation.event && operation.event.event && successResponse.includes(operation.event.event.responseType)) {
                            operationSuccess = true;
                        }
                    });
                });
                if (operationSuccess) {
                    return result;
                } else {
                    throw('success_response_unmatched');
                }
            }
        }).catch(err => {
            this.verbose('--> Command error:', err);
            throw(err);
        });
    }

    pushUpdates(data) {
        let updatesToSend = cloneObject(data || this.pendingUpdates);

        if (updatesToSend.length == 0) {
            return Promise.resolve(null);
        }

        if (!this.token || !this.connected) {
            this.verbose('API push updates cancelled as not connected to Nest.');
            return Promise.resolve(null);
        }

        // Workaround for strange Siri bug which tries to set heating/cooling threshold instead of actual temperature when
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

        if (this.failedPushAPICalls >= 2) {
            additionalDelay += API_TIMEOUT_SECONDS * 1000;
        }

        this.verbose('Pushing updates', updatesToSend.length, 'in', additionalDelay, 'ms');
        updatesToSend.forEach((el, index) => {
            this.verbose(index, '-', el.object);
        });

        let protobufUpdates = this.legacyToProtobufUpdate(this.filterProtobufUpdates(updatesToSend));

        return Promise.delay(additionalDelay).then(() => {
            if (updatesToSend.length) {
                return axios({
                    method: 'POST',
                    // followAllRedirects: true,
                    timeout: API_TIMEOUT_SECONDS * 1000,
                    url: this.transport_url + NestEndpoints.ENDPOINT_PUT,
                    headers: {
                        'User-Agent': NestEndpoints.USER_AGENT_STRING,
                        'Authorization': 'Basic ' + this.token,
                        'X-nl-protocol-version': 1
                    },
                    data: {
                        objects: updatesToSend.map(el => el.object)
                    },
                    // json: true
                });
            }
        }).then(() => {
            if (protobufUpdates) {
                return axios({
                    method: 'POST',
                    // followAllRedirects: true,
                    url: NestEndpoints.URL_PROTOBUF + NestEndpoints.ENDPOINT_UPDATE,
                    headers: {
                        'User-Agent': NestEndpoints.USER_AGENT_STRING,
                        'Authorization': 'Basic ' + this.token,
                        'Content-Type': 'application/x-protobuf',
                        'X-Accept-Content-Transfer-Encoding': 'binary',
                        'X-Accept-Response-Streaming': 'true'
                    },
                    data: protobufUpdates
                });
            }
        }).then(() => {
            this.failedPushAPICalls = 0;
        }).catch(error => {
            this.verbose(error);
            this.failedPushAPICalls++;
            error.status = error.response && error.response.status;
            if (!error.status || error.status != 401) {
                // 401 responses are normal when reauthentication is required - not actually a real "error"
                this.error('Nest API call to change device settings returned an error: ' + (error.status || error.code));
            }
            if (error.status == 401 || error.status == 403 || ['ECONNREFUSED','ESOCKETTIMEDOUT','ECONNABORTED','ENETUNREACH'].includes(error.code)) {
                // Token has probably expired, or transport endpoint has changed - re-authenticate and try again
                let additionalUpdates = this.pendingUpdates;
                this.pendingUpdates = updatesToSend;
                additionalUpdates.forEach(el => this.pendingUpdates.push(el));

                this.log('Reauthenticating on Nest service ...');
                return this.auth().then(() => {
                    if (this.mergeEndTimer) {
                        clearTimeout(this.mergeEndTimer);
                    }
                    return this.pushUpdates(data);
                }).catch(() => {
                    this.log('Reauthentication failed, waiting for ' + API_AUTH_FAIL_RETRY_DELAY_SECONDS + ' seconds.');
                    return Promise.delay(API_AUTH_FAIL_RETRY_DELAY_SECONDS * 1000).then(() => this.pushUpdates(data));
                });
            }
        });
    }

    legacyToProtobufUpdate(body) {
        function addToOutput(output, currentState, device, protoKey, protoType, key, value) {
            let found;
            output.forEach(el => {
                if ((el.object.id == 'DEVICE_' + device) && el.object.key == protoKey) {
                    found = el;
                }
            });
            if (!found) {
                let newEl = {
                    object: { id: 'DEVICE_' + device, key: protoKey, uuid: uuidv4() },
                    property: { type_url: protoType }
                };

                /* let updateInfo = {
                    updateSource: 'USER',
                    updatedBy: { value: this.protobufUserId },
                    timestamp: { value: getUnixTime() }
                }; */
                let updateInfo = {
                    updateSource: 'DEVICE',
                    updatedBy: { value: 'DEVICE_' + device },
                    timestamp: { value: getUnixTime() }
                };

                if (protoType == 'type.nestlabs.com/nest.trait.hvac.TargetTemperatureSettingsTrait') {
                    let targetTemperatureType = currentState.shared[device].target_temperature_type.toUpperCase();
                    let deviceActive = true;
                    if (targetTemperatureType == 'OFF') {
                        deviceActive = false;
                        targetTemperatureType = currentState.device[device].can_cool ? 'COOL' : 'HEAT';
                    }

                    /* let targetTemperatureHeat = (targetTemperatureType == 'HEAT' ? currentState.shared[device].target_temperature : currentState.shared[device].target_temperature_low);
                    let targetTemperatureCool = (targetTemperatureType == 'COOL' ? currentState.shared[device].target_temperature : currentState.shared[device].target_temperature_high);
                    if (targetTemperatureCool < targetTemperatureHeat) {
                        // Should not be possible - if HomeKit instructs this, we need to override with sensible values
                        if (targetTemperatureType == 'HEAT') {
                            targetTemperatureCool = targetTemperatureHeat + 5;
                        } else {
                            targetTemperatureHeat = targetTemperatureCool - 5;
                        }
                    } */

                    newEl.property.value = {};
                    newEl.property.value.settings = {
                        hvacMode: targetTemperatureType,
                        targetTemperatureHeat: { value: currentState.shared[device].target_temperature_low },
                        targetTemperatureCool: { value: currentState.shared[device].target_temperature_high },
                        // targetTemperatureHeat: { value: targetTemperatureHeat },
                        // targetTemperatureCool: { value: targetTemperatureCool },
                        updateInfo: updateInfo,
                        originalUpdateInfo: { updatedBy: { }, timestamp: { } }
                    };
                    newEl.property.value.active = { value: Number(deviceActive) };
                } else if (protoType == 'type.nestlabs.com/nest.trait.hvac.FanControlSettingsTrait') {
                    newEl.property.value = {
                        mode: currentState.device[device].fan_mode_protobuf || 'FAN_MODE_UNSPECIFIED',
                        hvacOverrideSpeed: currentState.device[device].fan_hvac_override_speed_protobuf || 'FAN_SPEED_SETTING_UNSPECIFIED',
                        scheduleSpeed: currentState.device[device].fan_schedule_speed_protobuf || 'FAN_SPEED_SETTING_UNSPECIFIED',
                        scheduleDutyCycle: currentState.device[device].fan_schedule_duty_cycle_protobuf || 0,
                        scheduleStartTime: currentState.device[device].fan_schedule_start_time_protobuf || 0,
                        scheduleEndTime: currentState.device[device].fan_schedule_end_time_protobuf || 0,
                        timerSpeed: currentState.device[device].fan_timer_speed_protobuf || 'FAN_SPEED_SETTING_UNSPECIFIED'
                    };
                    // newEl.property.value.updateInfo = updateInfo;
                } else if (protoType == 'type.nestlabs.com/nest.trait.hvac.EcoModeStateTrait') {
                    newEl.property.value = {};
                    newEl.property.value.updateInfo = updateInfo;
                } else if (protoType == 'type.nestlabs.com/nest.trait.hvac.EcoModeSettingsTrait') {
                    newEl.property.value = {
                        autoEcoEnabled: currentState.device[device].auto_away_enable ? 1 : 0,
                        low: { temperature: { value: currentState.device[device].away_temperature_low }, enabled: currentState.device[device].away_temperature_low_enabled ? 1 : 0 },
                        high: { temperature: { value: currentState.device[device].away_temperature_high }, enabled: currentState.device[device].away_temperature_high_enabled ? 1 : 0 }
                    };
                    /* } else if (protoType == 'type.nestlabs.com/weave.security.BoltLockTrait') {
                        newEl.property.value = {}; */
                }

                output.push(newEl);
                found = newEl;
            }

            if (key == 'target_temperature_type') {
                let targetTemperatureType = value.toUpperCase();
                let deviceActive = true;
                if (targetTemperatureType == 'ECO') {
                    if (currentState.device[device].away_temperature_low_enabled && currentState.device[device].away_temperature_high_enabled) {
                        targetTemperatureType = 'RANGE';
                    } else if (currentState.device[device].away_temperature_low_enabled) {
                        targetTemperatureType = 'HEAT';
                    } else if (currentState.device[device].away_temperature_high_enabled) {
                        targetTemperatureType = 'COOL';
                    } else {
                        targetTemperatureType = 'OFF';
                    }
                }
                if (targetTemperatureType == 'OFF') {
                    deviceActive = false;
                    targetTemperatureType = currentState.device[device].can_cool ? 'COOL' : 'HEAT';
                }
                found.property.value.settings.hvacMode = targetTemperatureType;
                found.property.value.active = { value: Number(deviceActive) };
            } else if (key == 'target_temperature_low') {
                if (found.property.value.settings.hvacMode != 'HEAT') {
                    found.property.value.settings.targetTemperatureHeat = { value: value };
                }
            } else if (key == 'target_temperature_high') {
                if (found.property.value.settings.hvacMode != 'COOL') {
                    found.property.value.settings.targetTemperatureCool = { value: value };
                }
            } else if (key == 'target_temperature') {
                if (found.property.value.settings.hvacMode == 'HEAT') {
                    found.property.value.settings.targetTemperatureHeat = { value: value };
                } else if (found.property.value.settings.hvacMode == 'COOL') {
                    found.property.value.settings.targetTemperatureCool = { value: value };
                }
            } else if (key == 'fan_timer_timeout') {
                found.property.value.fanTimerTimeout = { value: value };
                found.property.value.timerDuration = { };
            } else if (key == 'eco') {
                found.property.value.ecoEnabled = (value.mode == 'schedule') ? 'OFF' : 'ON';
                found.property.value.ecoModeChangeReason = 'ECO_MODE_CHANGE_REASON_MANUAL';
            } else if (key == 'away_temperature_low') {
                found.property.value.low.temperature = { value: value };
            } else if (key == 'away_temperature_high') {
                found.property.value.high.temperature = { value: value };
            } else if (key == 'away_temperature_low_enabled') {
                found.property.value.low.enabled = value ? 1 : 0;
            } else if (key == 'away_temperature_high_enabled') {
                found.property.value.high.enabled = value ? 1 : 0;
            }
        }

        let output = [];
        let data = body.map(el => ({ device: el.object.object_key.split('.')[1], prop: el.object.value }));

        // console.log(JSON.stringify(data, null, 2));

        data.forEach(req => {
            let device = req.device;
            let prop = req.prop;

            let protoKey, protoType;
            for (const key in prop) {
                let known = true;
                if (['target_temperature', 'target_temperature_high', 'target_temperature_low', 'target_temperature_type'].includes(key)) {
                    protoKey = 'target_temperature_settings';
                    protoType = 'type.nestlabs.com/nest.trait.hvac.TargetTemperatureSettingsTrait';
                } else if (['fan_timer_timeout'].includes(key)) {
                    protoKey = 'fan_control_settings';
                    protoType = 'type.nestlabs.com/nest.trait.hvac.FanControlSettingsTrait';
                } else if (['eco'].includes(key)) {
                    protoKey = 'eco_mode_state';
                    protoType = 'type.nestlabs.com/nest.trait.hvac.EcoModeStateTrait';
                } else if (['away_temperature_high', 'away_temperature_low'].includes(key)) {
                    protoKey = 'eco_mode_settings';
                    protoType = 'type.nestlabs.com/nest.trait.hvac.EcoModeSettingsTrait';
                } else {
                    known = false;
                }
                if (known) {
                    addToOutput.call(this, output, this.currentState, device, protoKey, protoType, key, prop[key]);
                }
                // Need to add more types
            }
        });

        if (output && output.length > 0) {
            this.verbose('-> Protobuf -', JSON.stringify(output, null, 2));
        }

        output.forEach(el => {
            // console.log(el.property.type_url);
            let trait = lookupTrait(this.proto, el.property.type_url);
            if (!trait) {
                this.verbose('Unable to find trait', el.property.type_url);
            } else {
                el.property.value = trait.encode(trait.fromObject(el.property.value)).finish();
            }
        });

        if (!output || output.length == 0) {
            return null;
        } else {
            let encodedData = this.TraitMap.encode(this.TraitMap.fromObject({ set: output })).finish();
            this.verbose('Batch update request:', encodedData.toString('base64'));
            return encodedData;
        }
    }

    filterProtobufUpdates(data) {
        // Removes and returns updates that require the protobuf API

        let protobufUpdates = [];
        for (let i = data.length - 1; i >= 0; i--) {
            if (data[i].using_protobuf) {
                protobufUpdates.push(data[i]);
                data.splice(i, 1);
            }
        }

        return protobufUpdates;
    }

    createNestBody(currentState, objects, objectList) {
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

            if (key == 'structure' && cloneObj.value && cloneObj.value.swarm) {
                let structureId = value;
                let oldMountedDeviceCount = cloneObject(this.mountedDeviceCount);
                this.mountedDeviceCount.rest[structureId] = cloneObj.value.swarm.length;
                this.verbose('REST API: structure ' + structureId + ', mounted', this.mountedDeviceCount.rest[structureId], 'device(s)');
                if (oldMountedDeviceCount.rest[structureId] !== undefined && oldMountedDeviceCount.rest[structureId] !== this.mountedDeviceCount.rest[structureId]) {
                    this.verbose('REST API: found device count for structure', structureId, 'has changed (protobuf):', oldMountedDeviceCount.rest[structureId], '->', this.mountedDeviceCount.rest[structureId]);
                    if (this.config.exitOnDeviceListChanged) {
                        process.exit(1);
                    }
                }
            }

            if (!currentState[key]) {
                currentState[key] = {};
            }

            // Previously we just set to cloneObj.value. This causes issues if a device or structure exists on both the REST
            // and the protobuf API. We now instead attempt to merge if we can.
            if (currentState[key][value] && typeof(cloneObj.value) == 'object' && !Array.isArray(cloneObj.value)) {
                for (let subkey of Object.keys(cloneObj.value)) {
                    // console.log('setting this.currentState.' + key + '.' + value + '.' + subkey + ' =', cloneObj.value[subkey])
                    currentState[key][value][subkey] = cloneObj.value[subkey];
                }
            } else {
                // console.log('overwriting this.currentState.' + key + '.' + value + ' =', cloneObj.value);
                currentState[key][value] = cloneObj.value;
            }
        });

        return currentState;
    }
}

function removeSubscribeObjectValues(objectList) {
    let result;
    try {
        result = { objects: cloneObject(objectList).objects.map(el => ({ object_key: el.object_key, object_revision: el.object_revision, object_timestamp: el.object_timestamp })) };
    } catch(error) {
        result = cloneObject(objectList);
    }

    return result;
}

function getUnixTime() {
    return Math.floor(Date.now() / 1000);
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

function transformTraits(object, proto) {
    object.forEach(el => {
        let type_url = el.data.property.type_url;
        let buffer = el.data.property.value;

        let pbufTrait = lookupTrait(proto, type_url);
        if (pbufTrait && buffer) {
            // console.log('Decoding buffer for trait: ' + type_url, buffer.toString('base64'));
            el.data.property.value = pbufTrait.toObject(pbufTrait.decode(buffer), { enums: String, defaults: true });
        }
    });
}

function lookupTrait(proto, type_url) {
    let pbufTrait = null;
    for (const traitKey in proto) {
        try {
            pbufTrait = pbufTrait || proto[traitKey].lookupType(type_url.split('/')[1]);
        } catch(error) {
            // Do nothing
        }
    }

    return pbufTrait;
}

function getProtoObject(object, key) {
    return object.filter(el => el.object.key == key);
}

function getProtoKeys(object) {
    return object.map(el => [ el.object.key, el.object.id, el.data && el.data.property && el.data.property.type_url ]);
}

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

module.exports = Connection;
