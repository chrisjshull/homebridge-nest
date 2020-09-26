/**
 * Created by kraig on 3/11/16.
 */

const inherits = require('util').inherits;
let Accessory, Service, Characteristic, uuid;

'use strict';

module.exports = function(exportedTypes) {
    if (exportedTypes && !Accessory) {
        Accessory = exportedTypes.Accessory;
        Service = exportedTypes.Service;
        Characteristic = exportedTypes.Characteristic;
        uuid = exportedTypes.uuid;

        const acc = NestDeviceAccessory.prototype;
        inherits(NestDeviceAccessory, Accessory);
        NestDeviceAccessory.prototype.parent = Accessory.prototype;
        for (const mn in acc) {
            NestDeviceAccessory.prototype[mn] = acc[mn];
        }
    }
    return {
        NestDeviceAccessory: NestDeviceAccessory,
        Accessory: Accessory,
        Service: Service,
        Characteristic: Characteristic
    };
};

// Base type for Nest devices
function NestDeviceAccessory(conn, log, device, structure, platform) {

    // device info
    this.conn = conn;
    this.name = this.homeKitSanitize(device.name_long || device.name);
    this.deviceId = device.device_id;
    this.log = log;
    this.device = device;
    this.structure = structure;
    this.structureId = structure.structure_id;
    this.platform = platform;

    this.log('initing ' + this.deviceType + ' "' + this.name + '":', 'deviceId:', this.deviceId, 'structureId:', this.structureId);
    // this.log.debug(this.device);

    const id = uuid.generate('nest' + '.' + this.deviceType + '.' + this.deviceId);
    this.accessory = new Accessory(this.name, id);
    this.uuid_base = id;

    this.addService = this.accessory._associatedHAPAccessory.addService.bind(this.accessory);
    this.getService = this.accessory._associatedHAPAccessory.getService.bind(this.accessory);
    this.setPrimaryService = this.accessory._associatedHAPAccessory.setPrimaryService.bind(this.accessory);

    this.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.FirmwareRevision, this.device.software_version)
        .setCharacteristic(Characteristic.Manufacturer, 'Nest')
        .setCharacteristic(Characteristic.Model, this.device.model || this.device.model_name || this.deviceDesc)
        .setCharacteristic(Characteristic.Name, this.name)
        .setCharacteristic(Characteristic.SerialNumber, this.device.serial_number || this.device.device_id || 'None');

    this.boundCharacteristics = [];

    // this.updateData();
}

NestDeviceAccessory.prototype.getServices = function () {
    return this.services;
};

NestDeviceAccessory.prototype.bindCharacteristic = function (service, characteristic, desc, getFunc, setFunc, format) {
    const actual = service.getCharacteristic(characteristic)
        .on('get', function (callback) {
            const val = getFunc.bind(this)();
            if (callback) callback(null, val);
        }.bind(this))
        .on('change', function (change) {
            let disp = change.newValue;
            if (format && disp !== null) {
                disp = format.call(this, disp);
            }
            this.log.debug(desc + ' for ' + this.name + ' is: ' + disp);
        }.bind(this));
    if (setFunc) {
        actual.on('set', setFunc.bind(this));
    }
    this.boundCharacteristics.push([service, characteristic]);
};

NestDeviceAccessory.prototype.temperatureNestToHomeKit = function(temperature) {
    /* if (this.device.temperature_scale == 'F') {
        return this.celsiusToFahrenheit(temperature);
    } else {
        return temperature;
    } */
    return temperature;
};

NestDeviceAccessory.prototype.fahrenheitToCelsius = function(temperature) {
    return (temperature - 32) / 1.8;
};

NestDeviceAccessory.prototype.celsiusToFahrenheit = function(temperature) {
    return (temperature * 1.8) + 32;
};

NestDeviceAccessory.prototype.updateData = function (device, structure) {
    if (device) {
        this.device = device;
    }
    if (structure) {
        this.structure = structure;
    }
    this.boundCharacteristics.map(function (c) {
        c[0].getCharacteristic(c[1]).getValue();
    });
};

NestDeviceAccessory.prototype.setPropertyAsync = function(type, property, value, propertyDescription, valueDescription, doNotUpdateLocalProperty) {
    propertyDescription = propertyDescription || property;
    valueDescription = valueDescription || value;
    this.log.debug('Setting ' + propertyDescription + ' for ' + this.name + ' to: ' + valueDescription);
    if (!doNotUpdateLocalProperty) {
        this.device[property] = value;
    }

    switch (type) {
    case 'structure': // Structure
        return this.conn.update(type + '.' + this.structureId, property, value, this.device.hvac_mode, false);
    case 'device':    // Thermostat
    case 'shared':    // Thermostat
    case 'topaz':     // Protect
    case 'kryptonite':     // Temperature Sensor
    case 'quartz':    // Camera
        return this.conn.update(type + '.' + this.deviceId, property, value, this.device.hvac_mode, this.device.using_protobuf);
    default:
        this.log.debug('Could not set property - unknown type: ' + type);
        return Promise.resolve(null);
    }
};

NestDeviceAccessory.prototype.homeKitSanitize = function(name) {
    // Returns a name containing only allowed HomeKit device name characters

    let fixedName = name.replace(/[^A-Za-z0-9 '-]/g, '') || 'Unnamed';
    return fixedName;
};
