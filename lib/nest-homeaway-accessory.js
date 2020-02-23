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

    if (this.platform.optionSet('HomeAway.AsOccupancySensor', this.device.serial_number, this.device.device_id) || this.platform.optionSet('HomeAway.AsOccupancySensorAndSwitch', this.device.serial_number, this.device.device_id)) {
        const homeService = this.addService(Service.OccupancySensor, this.homeKitSanitize(this.device.name), 'home_occupied_sensor.' + this.device.device_id);
        this.bindCharacteristic(homeService, Characteristic.OccupancyDetected, this.device.name, this.getHome);
    }

    if (!this.platform.optionSet('HomeAway.AsOccupancySensor', this.device.serial_number, this.device.device_id)) {
        const homeService = this.addService(Service.Switch, this.homeKitSanitize(this.device.name), 'home_occupied.' + this.device.device_id);
        this.bindCharacteristic(homeService, Characteristic.On, this.device.name, this.getHome, this.setHome);
    }

    this.updateData();
}

NestHomeAwayAccessory.prototype.getHome = function () {
    return !this.structure.away;
};

NestHomeAwayAccessory.prototype.setHome = function (home, callback) {
    if (this.structure.new_structure_id) {
        // Set using protobuf API
        let cmd = {
            traitLabel: 'structure_mode',
            command: {
                type_url: 'type.nestlabs.com/nest.trait.occupancy.StructureModeTrait.StructureModeChangeRequest',
                value: {
                    structureMode: home ? 'STRUCTURE_MODE_HOME' : 'STRUCTURE_MODE_AWAY',
                    reason: 'STRUCTURE_MODE_REASON_EXPLICIT_INTENT',
                    userId: {
                        resourceId: this.structure.user_id
                    }
                }
            }
        };

        return this.conn.protobufSendCommand([ cmd ], 'STRUCTURE_' + this.structure.new_structure_id).asCallback(callback);
    } else {
        // Set using REST API
        let val = !home ? 'away' : 'home';
        return this.setPropertyAsync('structure', 'away', val).asCallback(callback);
    }
};
