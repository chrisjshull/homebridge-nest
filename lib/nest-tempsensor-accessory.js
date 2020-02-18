/**
 * Created by Adrian Cable on 7/22/19.
 */

const inherits = require('util').inherits;
let Accessory, Service, Characteristic;
const NestDeviceAccessory = require('./nest-device-accessory')();

'use strict';

module.exports = function(exportedTypes) {
    if (exportedTypes && !Accessory) {
        Accessory = exportedTypes.Accessory;
        Service = exportedTypes.Service;
        Characteristic = exportedTypes.Characteristic;
        const acc = NestTempSensorAccessory.prototype;
        inherits(NestTempSensorAccessory, NestDeviceAccessory);
        NestTempSensorAccessory.prototype.parent = NestDeviceAccessory.prototype;
        for (const mn in acc) {
            NestTempSensorAccessory.prototype[mn] = acc[mn];
        }

        NestTempSensorAccessory.deviceType = 'temp_sensor';
        NestTempSensorAccessory.deviceGroup = 'temp_sensors';
        NestTempSensorAccessory.deviceDesc = 'Nest Temperature Sensor';
        NestTempSensorAccessory.prototype.deviceType = NestTempSensorAccessory.deviceType;
        NestTempSensorAccessory.prototype.deviceGroup = NestTempSensorAccessory.deviceGroup;
        NestTempSensorAccessory.prototype.deviceDesc = NestTempSensorAccessory.deviceDesc;
    }
    return NestTempSensorAccessory;
};

function NestTempSensorAccessory(conn, log, device, structure, platform) {
    NestDeviceAccessory.call(this, conn, log, device, structure, platform);

    const tempService = this.addService(Service.TemperatureSensor, this.homeKitSanitize(device.name), device.device_id);
    this.bindCharacteristic(tempService, Characteristic.CurrentTemperature, 'Temperature', this.getSensorTemperature, null, this.formatAsDisplayTemperature);

    let tempStep;
    if (!this.usesFahrenheit()) {
        tempStep = 0.5;
    }
    tempService.getCharacteristic(Characteristic.CurrentTemperature).setProps({ minStep: tempStep });

    tempService.addOptionalCharacteristic(Characteristic.StatusLowBattery);
    this.bindCharacteristic(tempService, Characteristic.StatusLowBattery, 'Battery Status', this.getBatteryStatus);

    this.updateData();
}

NestTempSensorAccessory.prototype.getSensorTemperature = function () {
    // return this.unroundTemperature('current_temperature');
    return this.temperatureNestToHomeKit(this.device.current_temperature);
};

NestTempSensorAccessory.prototype.formatAsDisplayTemperature = function(t) {
    return t + ' °C / ' + Math.round(celsiusToFahrenheit(t)) + ' °F';
};

function celsiusToFahrenheit(temperature) {
    return (temperature * 1.8) + 32;
}

NestTempSensorAccessory.prototype.usesFahrenheit = function () {
    return this.getTemperatureUnits() === Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
};

NestTempSensorAccessory.prototype.getTemperatureUnits = function () {
    switch (this.device.temperature_scale) {
    case 'F':
        return Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
    case 'C':
    default:
        return Characteristic.TemperatureDisplayUnits.CELSIUS;
    }
};

NestTempSensorAccessory.prototype.getBatteryStatus = function() {
    if (this.device.battery_status == 'BATTERY_REPLACEMENT_INDICATOR_NOT_AT_ALL') {
        return Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    } else if (this.device.battery_status == 'BATTERY_REPLACEMENT_INDICATOR_SOON' || this.device.battery_status == 'BATTERY_REPLACEMENT_INDICATOR_IMMEDIATELY') {
        return Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    } else {
        return null;
    }
};
