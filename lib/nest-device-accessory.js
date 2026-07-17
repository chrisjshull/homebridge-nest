/**
 * Created by kraig on 3/11/16.
 */

const inherits = require('util').inherits;
let Accessory, Service, Characteristic, uuid, hap;

'use strict';

module.exports = function(exportedTypes) {
    if (exportedTypes && !Accessory) {
        Accessory = exportedTypes.Accessory;
        Service = exportedTypes.Service;
        Characteristic = exportedTypes.Characteristic;
        uuid = exportedTypes.uuid;
        hap = exportedTypes.hap;

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
        Characteristic: Characteristic,
        hap: hap
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

    this.log('initing ' + this.deviceType + (device.using_protobuf ? ' (P)' : '') + ' "' + this.name + '":', 'deviceId:', this.deviceId, 'structureId:', this.structureId);
    // this.log.debug(this.device);

    const id = uuid.generate('nest' + '.' + this.deviceType + '.' + this.deviceId);
    this.accessory = new Accessory(this.name, id);
    this.uuid_base = id;

    this.addService = this.accessory._associatedHAPAccessory.addService.bind(this.accessory._associatedHAPAccessory);
    this.getService = this.accessory._associatedHAPAccessory.getService.bind(this.accessory._associatedHAPAccessory);
    // this.setPrimaryService = this.accessory._associatedHAPAccessory.setPrimaryService.bind(this.accessory._associatedHAPAccessory);

    this.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.FirmwareRevision, this.device.software_version || '1.0')
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
    // Keep getFunc so updateData can push fresh Nest state into HomeKit.
    this.boundCharacteristics.push([service, characteristic, getFunc]);
};

NestDeviceAccessory.prototype.fahrenheitToCelsius = function(temperature) {
    return (temperature - 32) / 1.8;
};

NestDeviceAccessory.prototype.celsiusToFahrenheit = function(temperature) {
    return (temperature * 1.8) + 32;
};

NestDeviceAccessory.prototype.unroundTemperature = function(temperature) {
    if (this.usesFahrenheit && this.usesFahrenheit()) {
        // Uses deg F? Round to nearest degree in F.
        let tempF = Math.round(this.celsiusToFahrenheit(temperature));
        return this.fahrenheitToCelsius(tempF);
    } else if (this.usesFahrenheit && !this.usesFahrenheit()) {
        // Uses deg C? Round to nearest half degree in C.
        let tempC = 0.5 * Math.round(2 * temperature);
        return tempC;
    } else {
        return temperature;
    }
};

// Clamp numeric values into a characteristic's HomeKit min/max so Nest values
// outside the writable range (e.g. unused threshold 0) don't warn on update.
NestDeviceAccessory.prototype.clampCharacteristicValue = function (ch, val) {
    if (typeof val !== 'number' || Number.isNaN(val)) {
        return val;
    }
    const props = ch.props || {};
    let v = val;
    if (typeof props.minValue === 'number' && v < props.minValue) {
        v = props.minValue;
    }
    if (typeof props.maxValue === 'number' && v > props.maxValue) {
        v = props.maxValue;
    }
    return v;
};

NestDeviceAccessory.prototype.updateData = function (device, structure) {
    if (device) {
        this.device = device;
    }
    if (structure) {
        this.structure = structure;
    }
    // Reading `.value` is a no-op and does not refresh HomeKit. Call the bound
    // getter and updateValue so Protect occupancy (and other chars) push on
    // Nest observe/subscribe events. Do not call removed HAP2 `.getValue()`.
    this.boundCharacteristics.forEach(function (c) {
        try {
            const ch = c[0].getCharacteristic(c[1]);
            const getFunc = c[2];
            if (!getFunc || typeof ch.updateValue !== 'function') {
                return;
            }
            let val = getFunc.call(this);
            val = this.clampCharacteristicValue(ch, val);
            if (val === undefined || val === null || (typeof val === 'number' && Number.isNaN(val))) {
                return;
            }
            ch.updateValue(val);
        } catch (e) {
            this.log.debug('updateData characteristic refresh failed: ' + (e && e.message));
        }
    }, this);
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
        return this.conn.update(type + '.' + this.structureId, property, value, this.isZirconium ? this.device.previous_hvac_mode : this.device.hvac_mode, false);
    case 'device':    // Thermostat
    case 'shared':    // Thermostat
    case 'topaz':     // Protect
    case 'kryptonite':     // Temperature Sensor
    case 'quartz':    // Camera
    case 'yale':      // Lock
        return this.conn.update(type + '.' + this.deviceId, property, value, this.isZirconium ? this.device.previous_hvac_mode : this.device.hvac_mode, this.device.using_protobuf);
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
