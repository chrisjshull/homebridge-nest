/**
 * Created by kraig on 3/11/16.
 */

var inherits = require('util').inherits;
var Promise = require('bluebird');
var Accessory, Service, Characteristic, uuid;
var Away, EcoMode, FanTimerActive, FanTimerDuration, HasLeaf, ManualTestActive, SunlightCorrectionEnabled, SunlightCorrectionActive, UsingEmergencyHeat;

'use strict';

function toTitleCase(str) {
  return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

module.exports = function(exportedTypes) {
    if (exportedTypes && !Accessory) {
        Accessory = exportedTypes.Accessory;
        Service = exportedTypes.Service;
        Characteristic = exportedTypes.Characteristic;
        uuid = exportedTypes.uuid;
        Away = exportedTypes.Away;
        EcoMode = exportedTypes.EcoMode;
        FanTimerActive = exportedTypes.FanTimerActive;
        FanTimerDuration = exportedTypes.FanTimerDuration;
        HasLeaf = exportedTypes.HasLeaf;
        ManualTestActive = exportedTypes.ManualTestActive;
        SunlightCorrectionEnabled = exportedTypes.SunlightCorrectionEnabled;
        SunlightCorrectionActive = exportedTypes.SunlightCorrectionActive;
        UsingEmergencyHeat = exportedTypes.UsingEmergencyHeat;

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
function NestDeviceAccessory(conn, log, device, structure, isStructure = false) { // todo: remove isStructure hack with proper

    // device info
    this.conn = conn;
    this.name = device.name_long || device.name;
    this.deviceId = device.device_id;
    this.log = log;
    this.device = device;
    this.structure = structure;
    this.structureId = structure.structure_id;

    var id = uuid.generate('nest' + '.' + this.deviceType + '.' + this.deviceId);
    Accessory.call(this, this.name, id);
    this.uuid_base = id;

    var infoSvc = this.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.FirmwareRevision, this.device.software_version.toUpperCase())
        .setCharacteristic(Characteristic.Manufacturer, "Nest")
        .setCharacteristic(Characteristic.Model, `${toTitleCase(this.deviceType)}`)
        .setCharacteristic(Characteristic.Name, this.name)
        .setCharacteristic(Characteristic.SerialNumber, this.device.name);

    this.boundCharacteristics = [];

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
            if (format && disp !== null) {
                disp = format(disp);
            }
            this.log.debug(desc + " for " + this.name + " is: " + disp);
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
    this.log.debug("Setting " + propertyDescription + " for " + this.name + " to: " + valueDescription);
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
            return true
        case "auto-away":
            return true;
        default:
            return false;
    }
};

NestDeviceAccessory.prototype.isEcoMode = function () {
    return (this.device.hvac_mode === "eco");
};

NestDeviceAccessory.prototype.isFanTimerActive = function () {
    return this.device.fan_timer_active;
};

NestDeviceAccessory.prototype.isFanTimerDuration = function () {
    return this.device.fan_timer_duration;
};

NestDeviceAccessory.prototype.isHasLeaf = function () {
    return this.device.has_leaf;
};

NestDeviceAccessory.prototype.isManualTestActive = function () {
    return this.device.is_manual_test_active;
};

NestDeviceAccessory.prototype.isSunlightCorrectionEnabled = function () {
    return this.device.sunlight_correction_enabled;
};

NestDeviceAccessory.prototype.isSunlightCorrectionActive = function () {
    return this.device.sunlight_correction_active;
};

NestDeviceAccessory.prototype.isUsingEmergencyHeat = function () {
    return this.device.is_using_emergency_heat;
};

NestDeviceAccessory.prototype.setAway = function (away, callback) {
    var val = away ? 'away' : 'home';
    this.log.info("Setting Away for " + this.name + " to: " + val);
    var promise = this.conn.update(this.getStructurePropertyPath("away"), val);
    return promise
        .return(away)
        .asCallback(callback);
};

NestDeviceAccessory.prototype.setEcoMode = function (eco, callback) {
    var val = eco ? 'eco' : this.device.previous_hvac_mode;
    this.log.info("Setting Eco Mode for " + this.name + " to: " + val);
	return this.updateDevicePropertyAsync("hvac_mode", val, "target heating cooling")
		.asCallback(callback);
};

NestDeviceAccessory.prototype.setFanTimerActive = function (fan, callback) {
    var val = fan;
    this.log.info("Setting Fan Timer Active for " + this.name + " to: " + val);
	if (this.device.hvac_mode !== "off" && this.device.hvac_state === "off") {
		return this.updateDevicePropertyAsync("fan_timer_active", val, "fan timer active")
			.asCallback(callback);
	} else {
		return;
	}
};

NestDeviceAccessory.prototype.setFanTimerDuration = function (timer, callback) {
    var val = timer;
    this.log.info("Setting Fan Timer Duration for " + this.name + " to: " + val);
	return this.updateDevicePropertyAsync("fan_timer_duration", val, "fan timer duration")
		.asCallback(callback);
};

NestDeviceAccessory.prototype.addAwayCharacteristic = function(service) {
    service.addCharacteristic(Away);
    this.bindCharacteristic(service, Away, "Away", this.isAway, this.setAway);
};

NestDeviceAccessory.prototype.addEcoModeCharacteristic = function(service) {
    service.addCharacteristic(EcoMode);
    this.bindCharacteristic(service, EcoMode, "Eco Mode", this.isEcoMode, this.setEcoMode);
};

NestDeviceAccessory.prototype.addFanTimerActiveCharacteristic = function(service) {
    service.addCharacteristic(FanTimerActive);
    this.bindCharacteristic(service, FanTimerActive, "Fan Timer Active", this.isFanTimerActive, this.setFanTimerActive);
};

NestDeviceAccessory.prototype.addFanTimerDurationCharacteristic = function(service) {
    service.addCharacteristic(FanTimerDuration);
    this.bindCharacteristic(service, FanTimerDuration, "Fan Timer Duration", this.isFanTimerDuration, this.setFanTimerDuration);
};

NestDeviceAccessory.prototype.addHasLeafCharacteristic = function(service) {
    service.addCharacteristic(HasLeaf);
    this.bindCharacteristic(service, HasLeaf, "Has Leaf", this.isHasLeaf);
};

NestDeviceAccessory.prototype.addManualTestActiveCharacteristic = function(service) {
    service.addCharacteristic(ManualTestActive);
    this.bindCharacteristic(service, ManualTestActive, "Manual Test Active", this.isManualTestActive);
};

NestDeviceAccessory.prototype.addSunlightCorrectionEnabledCharacteristic = function(service) {
    service.addCharacteristic(SunlightCorrectionEnabled);
    this.bindCharacteristic(service, SunlightCorrectionEnabled, "Sunlight Correction Enabled", this.isSunlightCorrectionEnabled);
};

NestDeviceAccessory.prototype.addSunlightCorrectionActiveCharacteristic = function(service) {
    service.addCharacteristic(SunlightCorrectionActive);
    this.bindCharacteristic(service, SunlightCorrectionActive, "Sunlight Correction Active", this.isSunlightCorrectionActive);
};

NestDeviceAccessory.prototype.addUsingEmergencyHeatCharacteristic = function(service) {
    service.addCharacteristic(UsingEmergencyHeat);
    this.bindCharacteristic(service, UsingEmergencyHeat, "Using Emergency Heat", this.isUsingEmergencyHeat);
};
