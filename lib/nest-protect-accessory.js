/**
 * Created by kraig on 3/11/16.
 */

'use strict';

const { NestDeviceAccessory, Service, Characteristic } = require('./nest-device-accessory')();

const nestDeviceDescriptor = {
    deviceType: 'protect',
    deviceGroup: 'smoke_co_alarms',
    deviceDesc: 'Nest Protect'
};

const AlarmState = {
    ok: 1,
    warning: 2,
    emergency: 3
};

class NestProtectAccessory extends NestDeviceAccessory {
    constructor(conn, log, device, structure, platform) {
        super(conn, log, device, structure, platform);

        const smokeSvc = this.addService(Service.SmokeSensor)
            .setCharacteristic(Characteristic.Name, this.homeKitSanitize(this.device.name + ' Smoke'));
        this.bindCharacteristic(smokeSvc, Characteristic.SmokeDetected, 'Smoke',
            this.getSmokeAlarmState, null, this.formatSmokeAlarmState);
        this.bindCharacteristic(smokeSvc, Characteristic.StatusLowBattery, 'Battery status (Smoke)',
            this.getBatteryHealth, null, this.formatStatusLowBattery);
        this.bindCharacteristic(smokeSvc, Characteristic.StatusActive, 'Online status (Smoke)',
            this.getOnlineStatus, null, this.formatOnlineStatus);

        const coSvc = this.addService(Service.CarbonMonoxideSensor)
            .setCharacteristic(Characteristic.Name, this.homeKitSanitize(this.device.name + ' Carbon Monoxide'));
        this.bindCharacteristic(coSvc, Characteristic.CarbonMonoxideDetected, 'Carbon Monoxide',
            this.getCarbonMonoxideAlarmState, null, this.formatCarbonMonoxideAlarmState);
        this.bindCharacteristic(coSvc, Characteristic.StatusLowBattery, 'Battery status (CO)',
            this.getBatteryHealth, null, this.formatStatusLowBattery);
        this.bindCharacteristic(coSvc, Characteristic.StatusActive, 'Online status (CO)',
            this.getOnlineStatus, null, this.formatOnlineStatus);

        if (!this.platform.optionSet('Protect.MotionSensor.Disable', this.device.serial_number, this.device.device_id) && this.device.line_power_present) {
            const occupancyService = this.addService(Service.OccupancySensor, this.homeKitSanitize(this.device.name + ' Occupancy'));
            this.bindCharacteristic(occupancyService, Characteristic.OccupancyDetected, 'Occupancy Detected', this.getOccupancyDetected);
        }

        // Add custom characteristics

        this.addManualTestActiveCharacteristic(smokeSvc);
        this.addManualTestActiveCharacteristic(coSvc);

        this.updateData();
    }

    // --- SmokeAlarmState ---

    getSmokeAlarmState() {
        switch (AlarmState[this.device.smoke_alarm_state]) {
        case AlarmState.ok:
            return Characteristic.SmokeDetected.SMOKE_NOT_DETECTED;
        default:
            return Characteristic.SmokeDetected.SMOKE_DETECTED;
        }
    }

    formatSmokeAlarmState(val) {
        switch (val) {
        case Characteristic.SmokeDetected.SMOKE_NOT_DETECTED:
            return 'not detected';
        case Characteristic.SmokeDetected.SMOKE_DETECTED:
            return 'detected';
        default:
            return 'unknown (' + val + ')';
        }
    }

    // --- CarbonMonoxideAlarmState ---

    getCarbonMonoxideAlarmState() {
        switch (AlarmState[this.device.co_alarm_state]) {
        case AlarmState.ok:
            return Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL;
        default:
            return Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL;
        }
    }

    formatCarbonMonoxideAlarmState(val) {
        switch (val) {
        case Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL:
            return 'normal';
        case Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL:
            return 'abnormal';
        default:
            return 'unknown (' + val + ')';
        }
    }

    // --- BatteryHealth ---

    getBatteryHealth() {
        switch (this.device.battery_health) {
        case 'ok':
            return Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
        default:
            return Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
        }
    }

    formatStatusLowBattery(val) {
        switch (val) {
        case Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL:
            return 'normal';
        case Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW:
            return 'low';
        default:
            return 'unknown (' + val + ')';
        }
    }

    // --- Motion ---

    getOccupancyDetected() {
        return this.device.auto_away ? Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED : Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;
    }

    // --- OnlineStatus ---

    getOnlineStatus() {
        return this.device.is_online;
    }

    formatOnlineStatus(val) {
        switch (val) {
        case true:
            return 'online';
        case false:
            return 'offline';
        default:
            return 'unknown (' + val + ')';
        }
    }

    addManualTestActiveCharacteristic(service) {
        service.addCharacteristic(ManualTestActive);
        this.bindCharacteristic(service, ManualTestActive, 'Manual Test Active', this.isManualTestActive);
    }

    isManualTestActive() {
        return this.device.is_manual_test_active || false;
    }
}

class ManualTestActive extends Characteristic {
    constructor() {
        super('Manual Test Active', 'D6D47D29-4643-4F44-B53C-D84015DAEBDB');

        this.setProps({
            format: Characteristic.Formats.BOOL,
            perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
        });
        this.value = this.getDefaultValue();
    }
}

module.exports = function() {
    Object.keys(nestDeviceDescriptor).forEach(key => NestProtectAccessory[key] = NestProtectAccessory.prototype[key] = nestDeviceDescriptor[key]);
    return NestProtectAccessory;
};
