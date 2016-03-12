/**
 * Created by kraig on 3/11/16.
 */

var inherits = require('util').inherits;
var Accessory, Service, Characteristic, Away, uuid;

'use strict';

module.exports = function(exportedTypes) {
    if (exportedTypes && !Accessory) {
        Accessory = exportedTypes.Accessory;
        Service = exportedTypes.Service;
        Characteristic = exportedTypes.Characteristic;
        uuid = exportedTypes.uuid;
        Away = exportedTypes.Away;

        var acc = NestDeviceAccessory.prototype;
        inherits(NestDeviceAccessory, Accessory);
        NestDeviceAccessory.prototype.parent = Accessory.prototype;
        for (var mn in acc) {
            NestDeviceAccessory.prototype[mn] = acc[mn];
        }
    }
    return NestDeviceAccessory;
};

// Base type for Nest devices
function NestDeviceAccessory(conn, log, device, structure) {

    // device info
    this.conn = conn;
    this.name = device.name;
    this.deviceId = device.device_id;
    this.log = log;
    this.device = device;
    this.structure = structure;
    this.structureId = structure.structure_id;

    var id = uuid.generate('nest.' + this.deviceType + '.' + this.deviceId);
    Accessory.call(this, this.name, id);
    this.uuid_base = id;

    var infoSvc = this.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, "Nest");

    infoSvc.removeCharacteristic(Characteristic.SerialNumber);
    infoSvc.removeCharacteristic(Characteristic.Model);

    this.boundCharacteristics = [];

    this.bindCharacteristic(infoSvc, Characteristic.SoftwareRevision, "Software version", function() {
        return this.device.software_version;
    });

    this.updateData();
}

NestDeviceAccessory.prototype.getServices = function () {
    return this.services;
};

NestDeviceAccessory.prototype.bindCharacteristic = function (service, characteristic, desc, getFunc, setFunc, format) {
    var actual = service.getCharacteristic(characteristic)
        .on('get', function (callback) {
            var val = getFunc.bind(this)();
            if (callback) callback(null, val);
        }.bind(this))
        .on('change', function (change) {
            var disp = change.newValue;
            if (format && disp != null) {
                disp = format(disp);
            }
            this.log(desc + " for " + this.name + " is: " + disp);
        }.bind(this));
    if (setFunc) {
        actual.on('set', setFunc.bind(this));
    }
    this.boundCharacteristics.push([service, characteristic]);
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

NestDeviceAccessory.prototype.getDevicePropertyPath = function(property) {
    return 'devices/' + this.deviceGroup + '/' + this.deviceId + '/' + property;
};

NestDeviceAccessory.prototype.updateDevicePropertyAsync = function(property, value, propertyDescription, valueDescription) {
    propertyDescription = propertyDescription || property;
    valueDescription = valueDescription || value;
    this.log("Setting " + propertyDescription + " for " + this.name + " to: " + valueDescription);
    return this.conn.update(this.getDevicePropertyPath(property), value)
        .return(value);
};

NestDeviceAccessory.prototype.getStructurePropertyPath = function(property) {
    return 'structures/' + this.structureId + '/' + property;
};

NestDeviceAccessory.prototype.isAway = function () {
    switch (this.structure.away) {
        case "home":
            return false;
        case "away":
        case "auto-away":
            return true;
        default:
            return false;
    }
};

NestDeviceAccessory.prototype.setAway = function (away, callback) {
    var val = away ? 'away' : 'home';
    this.log("Setting Away for " + this.name + " to: " + val);
    var promise = this.conn.update(this.getStructurePropertyPath("away"), val);
    return promise
        .return(away)
        .asCallback(callback);
};
