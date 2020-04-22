'use strict';

const axios = require('axios');

const NestConnection = require('./lib/nest-connection');

let ThermostatAccessory, HomeAwayAccessory, TempSensorAccessory, ProtectAccessory, LockAccessory;

require('promise.prototype.finally').shim(Promise);

Promise.delay = function(time_ms) {
    return new Promise(resolve => setTimeout(resolve, time_ms));
};

Promise.prototype.asCallback = function(callback) {
    this.then(res => callback(null, res)).catch(err => callback(err));
};

Promise.prototype.return = function(val) {
    this.then(function() {
        return val;
    });
};

class NestPlatform {
    constructor(log, config, api) {
        // auth info
        this.config = config;
        this.log = log;
        this.api = api;
        this.accessoryLookup = {};
    }

    optionSet(key, serialNumber, deviceId) {
        return key && this.config.options && (this.config.options.includes(key) || (serialNumber && this.config.options.includes(key + '.' + serialNumber)) || (deviceId && this.config.options.includes(key + '.' + deviceId)));
    }

    async setupConnection(verbose, fieldTestMode) {
        if (!this.config.access_token && !this.config.googleAuth && (!this.config.email || !this.config.password)) {
            throw('You did not specify your Nest account credentials {\'email\',\'password\'}, or an access_token, or googleAuth, in config.json');
        }

        if (this.config.googleAuth && (!this.config.googleAuth.issueToken || !this.config.googleAuth.cookies || !this.config.googleAuth.apiKey)) {
            throw('When using googleAuth, you must provide issueToken, cookies and apiKey in config.json. Please see README.md for instructions');
        }

        const conn = new NestConnection(this.config, this.log, verbose, fieldTestMode);

        if (await conn.auth()) {
            return conn;
        } else {
            throw('Unable to authenticate with Google/Nest.');
        }
    }

    async accessories(callback) {
        this.log('Fetching Nest devices.');

        const generateAccessories = function(data) {
            const foundAccessories = [];

            const loadDevices = function(DeviceType) {
                const disableFlags = {
                    'thermostat': 'Thermostat.Disable',
                    'temp_sensor': 'TempSensor.Disable',
                    'protect': 'Protect.Disable',
                    'home_away_sensor': 'HomeAway.Disable',
                    'lock': 'Lock.Disable'
                };

                const devices = (data.devices && data.devices[DeviceType.deviceGroup]) || {};
                for (const deviceId of Object.keys(devices)) {
                    const device = devices[deviceId];
                    const serialNumber = device.serial_number;
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
            loadDevices(HomeAwayAccessory);
            loadDevices(TempSensorAccessory);
            loadDevices(ProtectAccessory);
            loadDevices(LockAccessory);

            return foundAccessories;
        }.bind(this);

        const updateAccessories = function(data, accList) {
            accList.map(function(acc) {
                const device = data.devices[acc.deviceGroup][acc.deviceId];
                if (device) {
                    const structureId = device.structure_id;
                    const structure = data.structures[structureId];
                    acc.updateData(device, structure);
                }
            });
        };

        const handleUpdates = function(data) {
            if (Object.keys(this.accessoryLookup).length > 0) {
                updateAccessories(data, this.accessoryLookup);
            }
        }.bind(this);

        try {
            this.conn = await this.setupConnection(this.optionSet('Debug.Verbose'), this.optionSet('Nest.FieldTest.Enable'));
            await this.conn.subscribe(handleUpdates);
            await this.conn.observe(handleUpdates);

            let initialState = this.conn.apiResponseToObjectTree(this.conn.currentState);
            this.accessoryLookup = generateAccessories(initialState);
            if (callback) {
                callback(Array.from(this.accessoryLookup));
            }

            let accessoriesMounted = this.accessoryLookup.map(el => el.constructor.name);

            if (this.config.readyCallback) {
                axios.post(this.config.readyCallback, {
                    thermostat_count: accessoriesMounted.filter(el => el == 'NestThermostatAccessory').length,
                    tempsensor_count: accessoriesMounted.filter(el => el == 'NestTempSensorAccessory').length,
                    protect_count: accessoriesMounted.filter(el => el == 'NestProtectAccessory').length,
                    lock_count: accessoriesMounted.filter(el => el == 'NestLockAccessory').length
                }).catch(() => { });
            }
        } catch(err) {
            this.log.error(err);
            if (callback) {
                callback([]);
            }
        }
    }
}

module.exports = function(homebridge) {
    const exportedTypes = {
        Accessory: homebridge.hap.Accessory,
        Service: homebridge.hap.Service,
        Characteristic: homebridge.hap.Characteristic,
        hap: homebridge.hap,
        uuid: homebridge.hap.uuid
    };

    require('./lib/nest-device-accessory')(exportedTypes); // eslint-disable-line global-require
    ThermostatAccessory = require('./lib/nest-thermostat-accessory')(); // eslint-disable-line global-require
    HomeAwayAccessory = require('./lib/nest-homeaway-accessory')(); // eslint-disable-line global-require
    TempSensorAccessory = require('./lib/nest-tempsensor-accessory')(); // eslint-disable-line global-require
    ProtectAccessory = require('./lib/nest-protect-accessory')(); // eslint-disable-line global-require
    LockAccessory = require('./lib/nest-lock-accessory')(); // eslint-disable-line global-require

    homebridge.registerPlatform('homebridge-nest', 'Nest', NestPlatform);
};
