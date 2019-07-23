const NestConnection = require('./lib/nest-connection.js');
const NestMutex = require('./lib/nest-mutex.js');
const inherits = require('util').inherits;
const Promise = require('bluebird');

let Service, Characteristic, Accessory, uuid;
let ThermostatAccessory, TempSensorAccessory, ProtectAccessory, CamAccessory;

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.hap.Accessory;
    uuid = homebridge.hap.uuid;

    const exportedTypes = {
        Accessory: Accessory,
        Service: Service,
        Characteristic: Characteristic,
        uuid: uuid,
    };

    require('./lib/nest-device-accessory.js')(exportedTypes); // eslint-disable-line global-require
    ThermostatAccessory = require('./lib/nest-thermostat-accessory.js')(exportedTypes); // eslint-disable-line global-require
    TempSensorAccessory = require('./lib/nest-tempsensor-accessory.js')(exportedTypes); // eslint-disable-line global-require
    ProtectAccessory = require('./lib/nest-protect-accessory.js')(exportedTypes); // eslint-disable-line global-require
    CamAccessory = require('./lib/nest-cam-accessory.js')(exportedTypes); // eslint-disable-line global-require

    homebridge.registerPlatform('homebridge-nest', 'Nest', NestPlatform);
};

function NestPlatform(log, config) {
    // auth info
    this.config = config;

    this.log = log;
    this.accessoryLookup = {};
}

const setupConnection = function(config, log) {
    return new Promise(function (resolve, reject) {
        const email = config.email;
        const password = config.password;
        const pin = config.pin;
        const token = '';

        let err;
        if (!email || !password) {
            err = 'You did not specify your Nest app {\'email\',\'password\'} in config.json';
        }
        if (err) {
            reject(new Error(err));
            return;
        }

        const conn = new NestConnection(token, log);
        conn.config = config;
        conn.mutex = new NestMutex(log);
        if (token) {
            resolve(conn);
        } else {
            conn.auth(email, password, pin)
                .then(() => {
                    resolve(conn);
                })
                .catch(function(authError){
                    if (log) {
                        if (authError.code == 400) {
                            log.warn('Auth failed: email/password is not valid. Check you are using the correct email/password for your Nest account');
                        } else if (authError.code == 429) {
                            log.warn('Auth failed: rate limit exceeded. Please try again in 60 minutes');
                        } else if (authError.code == '2fa_error') {
                            log.warn('Auth failed: 2FA PIN was rejected');
                        } else {
                            log.warn('Auth failed: could not connect to Nest service. Check your Internet connection');
                        }
                    }
                    reject(authError);
                });
        }
    });
};

NestPlatform.prototype = {
    optionSet: function (key, serialNumber, deviceId) {
        return key && this.config.options && (this.config.options.includes(key) || (serialNumber && this.config.options.includes(key + '.' + serialNumber)) || (deviceId && this.config.options.includes(key + '.' + deviceId)));
    },
    accessories: function (callback) {
        this.log('Fetching Nest devices.');

        const that = this;

        const generateAccessories = function(data) {
            const foundAccessories = [];

            const loadDevices = function(DeviceType) {
                const disableFlags = {
                    'thermostat': 'Thermostat.Disable',
                    'temp_sensor': 'TempSensor.Disable',
                    'protect': 'Protect.Disable'
                };

                const devices = (data.devices && data.devices[DeviceType.deviceGroup]) || {};
                for (const deviceId of Object.keys(devices)) {
                    const device = devices[deviceId];
                    const serialNumber = device.serial_number;
                    // console.log(disableFlags[DeviceType.deviceType], serialNumber, deviceId);
                    if (!this.optionSet(disableFlags[DeviceType.deviceType], serialNumber, deviceId)) {
                        const structureId = device.structure_id;
                        if (this.config.structureId && this.config.structureId !== structureId) {
                            this.log('Skipping device ' + deviceId + ' because it is not in the required structure. Has ' + structureId + ', looking for ' + this.config.structureId + '.');
                            continue;
                        }
                        const structure = data.structures[structureId];
                        const accessory = new DeviceType(this.conn, this.log, device, structure, this);
                        this.accessoryLookup[deviceId] = accessory;
                        foundAccessories.push(accessory);
                    }
                }
            }.bind(this);

            loadDevices(ThermostatAccessory);
            loadDevices(TempSensorAccessory);
            loadDevices(ProtectAccessory);
            // loadDevices(CamAccessory);

            return foundAccessories;
        }.bind(this);

        const updateAccessories = function(data, accList) {
            accList.map(function(acc) {
                const device = data.devices[acc.deviceGroup][acc.deviceId];
                const structureId = device.structure_id;
                const structure = data.structures[structureId];
                acc.updateData(device, structure);
            });
        };

        const handleUpdates = function(data){
            updateAccessories(data, that.accessoryLookup);
        };
        setupConnection(this.config, this.log)
            .then(function(conn){
                that.conn = conn;
                return that.conn.subscribe(handleUpdates);
            })
            .then(function(data) {
                that.accessoryLookup = generateAccessories(data);
                if (callback) {
                    const copy = Array.from(that.accessoryLookup);
                    callback(copy);
                }
            })
            .catch(function(err) {
                that.log.error(err);
                if (callback) {
                    callback([]);
                }
            });
    }
};
