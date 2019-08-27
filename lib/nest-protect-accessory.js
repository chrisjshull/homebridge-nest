/**
 * Created by kraig on 3/11/16.
 */

const inherits = require('util').inherits;
let Accessory, Service, Characteristic; // , Away, uuid;
let ManualTestActive;
const NestDeviceAccessory = require('./nest-device-accessory')();

const AlarmState = {
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

        /*
        * Characteristic "ManualTestActive"
        */
        ManualTestActive = function () {
            Characteristic.call(this, 'Manual Test Active', 'D6D47D29-4643-4F44-B53C-D84015DAEBDB');
            this.setProps({
                format: Characteristic.Formats.BOOL,
                perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        };
        inherits(ManualTestActive, Characteristic);


        const acc = NestProtectAccessory.prototype;
        inherits(NestProtectAccessory, NestDeviceAccessory);
        NestProtectAccessory.prototype.parent = NestDeviceAccessory.prototype;
        for (const mn in acc) {
            NestProtectAccessory.prototype[mn] = acc[mn];
        }

        NestProtectAccessory.deviceType = 'protect';
        NestProtectAccessory.deviceGroup = 'smoke_co_alarms';
        NestProtectAccessory.deviceDesc = 'Nest Protect';
        NestProtectAccessory.prototype.deviceType = NestProtectAccessory.deviceType;
        NestProtectAccessory.prototype.deviceGroup = NestProtectAccessory.deviceGroup;
        NestProtectAccessory.prototype.deviceDesc = NestProtectAccessory.deviceDesc;
    }

    return NestProtectAccessory;
};

function NestProtectAccessory(conn, log, device, structure, platform) {
    NestDeviceAccessory.call(this, conn, log, device, structure, platform);

    const smokeSvc = this.addService(Service.SmokeSensor)
        .setCharacteristic(Characteristic.Name, this.device.name + ' Smoke');
    this.bindCharacteristic(smokeSvc, Characteristic.SmokeDetected, 'Smoke',
        this.getSmokeAlarmState, null, this.formatSmokeAlarmState);
    this.bindCharacteristic(smokeSvc, Characteristic.StatusLowBattery, 'Battery status (Smoke)',
        this.getBatteryHealth, null, this.formatStatusLowBattery);
    this.bindCharacteristic(smokeSvc, Characteristic.StatusActive, 'Online status (Smoke)',
        this.getOnlineStatus, null, this.formatOnlineStatus);

    const coSvc = this.addService(Service.CarbonMonoxideSensor)
        .setCharacteristic(Characteristic.Name, this.device.name + ' Carbon Monoxide');
    this.bindCharacteristic(coSvc, Characteristic.CarbonMonoxideDetected, 'Carbon Monoxide',
        this.getCarbonMonoxideAlarmState, null, this.formatCarbonMonoxideAlarmState);
    this.bindCharacteristic(coSvc, Characteristic.StatusLowBattery, 'Battery status (CO)',
        this.getBatteryHealth, null, this.formatStatusLowBattery);
    this.bindCharacteristic(coSvc, Characteristic.StatusActive, 'Online status (CO)',
        this.getOnlineStatus, null, this.formatOnlineStatus);

    if (!this.platform.optionSet('Protect.MotionSensor.Disable', this.device.serial_number, this.device.device_id)) {
        const motionService = this.addService(Service.MotionSensor, this.device.name + ' Motion');
        this.bindCharacteristic(motionService, Characteristic.MotionDetected, 'Motion Detected', this.getMotionDetected);
    }

    // Add custom characteristics

    this.addManualTestActiveCharacteristic(smokeSvc);
    this.addManualTestActiveCharacteristic(coSvc);

    this.updateData();
}

// --- SmokeAlarmState ---

NestProtectAccessory.prototype.getSmokeAlarmState = function() {
    switch (AlarmState[this.device.smoke_alarm_state]) {
    case AlarmState.ok:
        return Characteristic.SmokeDetected.SMOKE_NOT_DETECTED;
    default:
        return Characteristic.SmokeDetected.SMOKE_DETECTED;
    }
};

NestProtectAccessory.prototype.formatSmokeAlarmState = function(val) {
    switch (val) {
    case Characteristic.SmokeDetected.SMOKE_NOT_DETECTED:
        return 'not detected';
    case Characteristic.SmokeDetected.SMOKE_DETECTED:
        return 'detected';
    default:
        return 'unknown (' + val + ')';
    }
};

// --- CarbonMonoxideAlarmState ---

NestProtectAccessory.prototype.getCarbonMonoxideAlarmState = function() {
    switch (AlarmState[this.device.co_alarm_state]) {
    case AlarmState.ok:
        return Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL;
    default:
        return Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL;
    }
};

NestProtectAccessory.prototype.formatCarbonMonoxideAlarmState = function(val) {
    switch (val) {
    case Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL:
        return 'normal';
    case Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL:
        return 'abnormal';
    default:
        return 'unknown (' + val + ')';
    }
};

// --- BatteryHealth ---

NestProtectAccessory.prototype.getBatteryHealth = function () {
    switch (this.device.battery_health) {
    case 'ok':
        return Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    default:
        return Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    }
};

NestProtectAccessory.prototype.formatStatusLowBattery = function (val) {
    switch (val) {
    case Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL:
        return 'normal';
    case Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW:
        return 'low';
    default:
        return 'unknown (' + val + ')';
    }
};

// --- Motion ---

NestProtectAccessory.prototype.getMotionDetected = function(val) {
    return !this.device.auto_away;
};

// --- OnlineStatus ---

NestProtectAccessory.prototype.getOnlineStatus = function () {
    return this.device.is_online;
};

NestProtectAccessory.prototype.formatOnlineStatus = function (val) {
    switch (val) {
    case true:
        return 'online';
    case false:
        return 'offline';
    default:
        return 'unknown (' + val + ')';
    }
};

NestProtectAccessory.prototype.addManualTestActiveCharacteristic = function(service) {
    service.addCharacteristic(ManualTestActive);
    this.bindCharacteristic(service, ManualTestActive, 'Manual Test Active', this.isManualTestActive);
};

NestProtectAccessory.prototype.isManualTestActive = function () {
    return this.device.is_manual_test_active;
};

