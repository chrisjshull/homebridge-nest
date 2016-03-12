/**
 * Created by kraig on 3/11/16.
 */

var inherits = require('util').inherits;
var Accessory, Service, Characteristic, Away, uuid;
var NestDeviceAccessory = require('./nest-device-accessory')();

var AlarmState = {
    ok: 1,
    warning: 2,
    emergency: 3
};

'use strict';

module.exports = function(exportedTypes) {
    if (exportedTypes && !Accessory) {
        Accessory = exportedTypes.Accessory;
        Service = exportedTypes.Service;
        Characteristic = exportedTypes.Characteristic;
        uuid = exportedTypes.uuid;
        Away = exportedTypes.Away;

        var acc = NestProtectAccessory.prototype;
        inherits(NestProtectAccessory, NestDeviceAccessory);
        NestProtectAccessory.prototype.parent = NestDeviceAccessory.prototype;
        for (var mn in acc) {
            NestProtectAccessory.prototype[mn] = acc[mn];
        }

        NestProtectAccessory.deviceType = 'protect';
        NestProtectAccessory.deviceGroup = 'smoke_co_alarms';
        NestProtectAccessory.prototype.deviceType = NestProtectAccessory.deviceType;
        NestProtectAccessory.prototype.deviceGroup = NestProtectAccessory.deviceGroup;
    }
    return NestProtectAccessory;
};

function NestProtectAccessory(conn, log, device, structure) {
    NestDeviceAccessory.call(this, conn, log, device, structure);

    var smokeSvc = this.addService(Service.SmokeSensor);
    this.bindCharacteristic(smokeSvc, Characteristic.SmokeDetected, "Smoke",
        getSmokeAlarmState.bind(this), null, formatSmokeAlarmState.bind(this));
    this.bindCharacteristic(smokeSvc, Characteristic.StatusLowBattery, "Battery status (Smoke)",
        getBatteryHealth.bind(this), null, formatStatusLowBattery.bind(this));

    var coSvc = this.addService(Service.CarbonMonoxideSensor);
    this.bindCharacteristic(coSvc, Characteristic.CarbonMonoxideDetected, "Carbon Monoxide",
        getCarbonMonoxideAlarmState.bind(this), null, formatCarbonMonoxideAlarmState.bind(this));
    this.bindCharacteristic(coSvc, Characteristic.StatusLowBattery, "Battery status (CO)",
        getBatteryHealth.bind(this), null, formatStatusLowBattery.bind(this));

    this.updateData();
}


// --- SmokeAlarmState ---

var getSmokeAlarmState = function() {
    switch (AlarmState[this.device.smoke_alarm_state]) {
        case AlarmState.ok:
            return Characteristic.SmokeDetected.SMOKE_NOT_DETECTED;
        default:
            return Characteristic.SmokeDetected.SMOKE_DETECTED;
    }
};

var formatSmokeAlarmState = function(val) {
    switch (val) {
        case Characteristic.SmokeDetected.SMOKE_NOT_DETECTED:
            return "not detected";
        case Characteristic.SmokeDetected.SMOKE_DETECTED:
            return "detected";
        default:
            return "unknown (" + val + ")";
    }
};


// --- CarbonMonoxideAlarmState ---

var getCarbonMonoxideAlarmState = function() {
    switch (AlarmState[this.device.co_alarm_state]) {
        case AlarmState.ok:
            return Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL;
        default:
            return Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL;
    }
};

var formatCarbonMonoxideAlarmState = function(val) {
    switch (val) {
        case Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL:
            return "normal";
        case Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL:
            return "abnormal";
        default:
            return "unknown (" + val + ")";
    }
};


// --- BatteryHealth ---

var getBatteryHealth = function () {
    switch (this.device.battery_health) {
        case 'ok':
            return Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
        default:
            return Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    }
};

var formatStatusLowBattery = function (val) {
    switch (val) {
        case Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL:
            return 'normal';
        case Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW:
            return 'low';
        default:
            return 'unknown (' + val + ')';
    }
};
