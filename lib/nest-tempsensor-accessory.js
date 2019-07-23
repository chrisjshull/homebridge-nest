/**
 * Created by Adrian Cable on 7/22/19.
 */

const Promise = require('bluebird');
const debounce = require('lodash.debounce');
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
        NestTempSensorAccessory.prototype.deviceType = NestTempSensorAccessory.deviceType;
        NestTempSensorAccessory.prototype.deviceGroup = NestTempSensorAccessory.deviceGroup;
    }
    return NestTempSensorAccessory;
};

function NestTempSensorAccessory(conn, log, device, structure, platform) {
    NestDeviceAccessory.call(this, conn, log, device, structure, platform);

    if (!this.platform.optionSet('Thermostat.TemperatureSensors.Disable')) {
        const tempService = this.addService(Service.TemperatureSensor, device.name, device.device_id);
        this.bindCharacteristic(tempService, Characteristic.CurrentTemperature, 'Temperature', this.getSensorTemperature);
    }

    this.updateData();
}

NestTempSensorAccessory.prototype.getSensorTemperature = function () {
    return (this.device.current_temperature);
};
