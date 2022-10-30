'use strict';

const { NestDeviceAccessory, Service, Characteristic } = require('./nest-device-accessory')();

const nestDeviceDescriptor = {
    deviceType: 'detect',
    deviceGroup: 'detects',
    deviceDesc: 'Nest Detect'
};

class NestDetectAccessory extends NestDeviceAccessory {
    constructor(conn, log, device, structure, platform) {
        super(conn, log, device, structure, platform);

        const detectService = this.addService(Service.ContactSensor)
             .setCharacteristic(Characteristic.Name, this.homeKitSanitize(this.device.name + ' Contact'));

        this.bindCharacteristic(detectService, Characteristic.ContactSensorState, 'Contact Detected', this.getContactDetected);

        detectService.addOptionalCharacteristic(Characteristic.StatusLowBattery);
        this.bindCharacteristic(detectService, Characteristic.StatusLowBattery, 'Battery Status', this.getBatteryStatus);

        this.updateData();
    }

    // --- Door open close ---

    getContactDetected() {
        return this.device.door_open ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED;
    }

    // --- Battery Status ---

    getBatteryStatus() {
        if (this.device.battery_status == 'BATTERY_REPLACEMENT_INDICATOR_NOT_AT_ALL') {
            return Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
        } else if (this.device.battery_status == 'BATTERY_REPLACEMENT_INDICATOR_SOON' || this.device.battery_status == 'BATTERY_REPLACEMENT_INDICATOR_IMMEDIATELY') {
            return Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
        } else {
            return null;
        }
    }
}

module.exports = function() {
    Object.keys(nestDeviceDescriptor).forEach(key => NestDetectAccessory[key] = NestDetectAccessory.prototype[key] = nestDeviceDescriptor[key]);
    return NestDetectAccessory;
};
