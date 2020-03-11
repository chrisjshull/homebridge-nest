/**
 * Created by Adrian Cable on 7/22/19.
 */

'use strict';

const { NestDeviceAccessory, Service, Characteristic } = require('./nest-device-accessory')();

const nestDeviceDescriptor = {
    deviceType: 'temp_sensor',
    deviceGroup: 'temp_sensors',
    deviceDesc: 'Nest Temperature Sensor'
};

class NestTempSensorAccessory extends NestDeviceAccessory {
    constructor(conn, log, device, structure, platform) {
        super(conn, log, device, structure, platform);

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

    getSensorTemperature() {
        // return this.unroundTemperature('current_temperature');
        return this.temperatureNestToHomeKit(this.device.current_temperature);
    }

    formatAsDisplayTemperature(t) {
        return t + ' °C / ' + Math.round(celsiusToFahrenheit(t)) + ' °F';
    }

    usesFahrenheit() {
        return this.getTemperatureUnits() === Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
    }

    getTemperatureUnits() {
        switch (this.device.temperature_scale) {
        case 'F':
            return Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
        case 'C':
        default:
            return Characteristic.TemperatureDisplayUnits.CELSIUS;
        }
    }

    getBatteryStatus() {
        if (this.device.battery_voltage > 2.66) {
            return Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
        } else if (this.device.battery_voltage > 0) {
            return Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
        } else {
            return null;
        }
    }
}

function celsiusToFahrenheit(temperature) {
    return (temperature * 1.8) + 32;
}

module.exports = function() {
    Object.keys(nestDeviceDescriptor).forEach(key => NestTempSensorAccessory[key] = NestTempSensorAccessory.prototype[key] = nestDeviceDescriptor[key]);
    return NestTempSensorAccessory;
};
