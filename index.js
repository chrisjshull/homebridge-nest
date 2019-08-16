const NestConnection = require('./lib/nest-connection.js');
const Promise = require('bluebird');

let Service, Characteristic, Accessory, uuid;
let ThermostatAccessory, HomeAwayAccessory, TempSensorAccessory, ProtectAccessory; //, CamAccessory;

module.exports = function(homebridge) {
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
    HomeAwayAccessory = require('./lib/nest-homeaway-accessory.js')(exportedTypes); // eslint-disable-line global-require
    TempSensorAccessory = require('./lib/nest-tempsensor-accessory.js')(exportedTypes); // eslint-disable-line global-require
    ProtectAccessory = require('./lib/nest-protect-accessory.js')(exportedTypes); // eslint-disable-line global-require
    // CamAccessory = require('./lib/nest-cam-accessory.js')(exportedTypes); // eslint-disable-line global-require

    homebridge.registerPlatform('homebridge-nest', 'Nest', NestPlatform);
};

function NestPlatform(log, config) {
    // auth info
    this.config = config;

    this.log = log;
    this.accessoryLookup = {};
}

const setupConnection = function(config, log, verbose) {
    return new Promise(function (resolve, reject) {
        if (!config.access_token && (!config.email || !config.password)) {
            reject('You did not specify your Nest app credentials {\'email\',\'password\'}, or an access_token, in config.json');
            return;
        }

        const conn = new NestConnection(config, log, verbose);
        conn.auth().then(connected => {
            if (connected) {
                resolve(conn);
            } else {
                reject('Unable to connect to Nest service.');
            }
        });
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
                    'protect': 'Protect.Disable',
                    'home_away_sensor': 'HomeAway.Disable'
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

        const handleUpdates = function(data) {
            updateAccessories(data, that.accessoryLookup);
        };
        setupConnection(this.config, this.log, this.optionSet('Debug.Verbose'))
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
