/**
 * Created by Adrian Cable on 7/26/19.
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
        const acc = NestHomeAwayAccessory.prototype;
        inherits(NestHomeAwayAccessory, NestDeviceAccessory);
        NestHomeAwayAccessory.prototype.parent = NestDeviceAccessory.prototype;
        for (const mn in acc) {
            NestHomeAwayAccessory.prototype[mn] = acc[mn];
        }

        NestHomeAwayAccessory.deviceType = 'home_away_sensor';
        NestHomeAwayAccessory.deviceGroup = 'home_away_sensors';
        NestHomeAwayAccessory.deviceDesc = 'Nest Home/Away Sensor';
        NestHomeAwayAccessory.prototype.deviceType = NestHomeAwayAccessory.deviceType;
        NestHomeAwayAccessory.prototype.deviceGroup = NestHomeAwayAccessory.deviceGroup;
        NestHomeAwayAccessory.prototype.deviceDesc = NestHomeAwayAccessory.deviceDesc;
    }
    return NestHomeAwayAccessory;
};

function NestHomeAwayAccessory(conn, log, device, structure, platform) {
    NestDeviceAccessory.call(this, conn, log, device, structure, platform);

    if (this.platform.optionSet('HomeAway.AsOccupancySensor', this.device.serial_number, this.device.device_id)) {
        const homeService = this.addService(Service.OccupancySensor, 'Home Occupied', 'home_occupied');
        this.bindCharacteristic(homeService, Characteristic.OccupancyDetected, 'Home Occupied', this.getHome, null);
    } else {
        const homeService = this.addService(Service.Switch, 'Home Occupied', 'home_occupied');
        this.bindCharacteristic(homeService, Characteristic.On, 'Home Occupied', this.getHome, this.setHome);
    }

    this.updateData();
}

NestHomeAwayAccessory.prototype.getHome = function () {
    return !this.structure.away;
};

NestHomeAwayAccessory.prototype.setHome = function (home, callback) {
    const val = !home ? 'away' : 'home';
    this.log.info('Setting Home for ' + this.name + ' to: ' + val);
    this.conn.mutex.startPropertyUpdate(this.conn.mutex.updateStates.homeAwayMode);
    return this.conn.update(this.getStructurePropertyPath('away'), val).return(home).asCallback(callback).finally(() => this.conn.mutex.endPropertyUpdate(this.conn.mutex.updateStates.homeAwayMode));
};
