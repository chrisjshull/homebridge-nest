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

        const tempService = this.addService(Service.TemperatureSensor, this.homeKitSanitize(this.device.name), this.device.device_id);
        this.bindCharacteristic(tempService, Characteristic.CurrentTemperature, 'Temperature', this.getSensorTemperature, null, this.formatAsDisplayTemperature);

        let minGetTemp, maxGetTemp;
        this.tempStep = 0.1; // 0.5;
        if (this.usesFahrenheit()) {
            minGetTemp = this.fahrenheitToCelsius(0);
            maxGetTemp = this.fahrenheitToCelsius(160);
        } else {
            minGetTemp = -20;
            maxGetTemp = 60;
        }

        tempService.getCharacteristic(Characteristic.CurrentTemperature).setProps({ minStep: this.tempStep, minValue: minGetTemp, maxValue: maxGetTemp });

        tempService.addOptionalCharacteristic(Characteristic.StatusLowBattery);
        this.bindCharacteristic(tempService, Characteristic.StatusLowBattery, 'Battery Status', this.getBatteryStatus);

        tempService.addOptionalCharacteristic(Characteristic.StatusActive);
        this.bindCharacteristic(tempService, Characteristic.StatusActive, 'Status Active', this.getActiveStatus);

        // Switch to select the active sensor
        let switchSelectSensor = this.addService(Service.Switch, this.homeKitSanitize(this.device.name) + " Sensor", 'switch.' + this.device.device_id);
        this.bindCharacteristic(switchSelectSensor, Characteristic.On, 'Select', this.getActiveStatus, this.setActiveStatus);

        this.updateData();
    }

    getSensorTemperature() {
        // return this.unroundTemperature('current_temperature');
        return this.unroundTemperature(this.device.current_temperature);
    }

    formatAsDisplayTemperature(t) {
        let precision = 0.001;
        return (precision * Math.round(t / precision)) + ' °C / ' + (precision * Math.round(this.celsiusToFahrenheit(t) / precision)) + ' °F';
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

    usesFahrenheit() {
        return this.getTemperatureUnits() === Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
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

    getActiveStatus() {
        return this.device.active;
    }

    setActiveStatus(state, callback) {
        this.setPropertyAsync('rcs_settings', 'active_rcs_sensors', {thermostat: this.device.thermostat_device_id, sensor: this.device.device_id}, 'active sensor switch').asCallback(callback);
    }
}

module.exports = function() {
    Object.keys(nestDeviceDescriptor).forEach(key => NestTempSensorAccessory[key] = NestTempSensorAccessory.prototype[key] = nestDeviceDescriptor[key]);
    return NestTempSensorAccessory;
};
