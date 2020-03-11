/**
 * Created by Adrian Cable on 7/26/19.
 */

'use strict';

const { NestDeviceAccessory, Service, Characteristic } = require('./nest-device-accessory')();

const nestDeviceDescriptor = {
    deviceType: 'home_away_sensor',
    deviceGroup: 'home_away_sensors',
    deviceDesc: 'Nest Home/Away Sensor'
};

class NestHomeAwayAccessory extends NestDeviceAccessory {
    constructor(conn, log, device, structure, platform) {
        super(conn, log, device, structure, platform);

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

    getHome() {
        return !this.structure.away;
    }

    setHome(home, callback) {
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
    }
}

module.exports = function() {
    Object.keys(nestDeviceDescriptor).forEach(key => NestHomeAwayAccessory[key] = NestHomeAwayAccessory.prototype[key] = nestDeviceDescriptor[key]);
    return NestHomeAwayAccessory;
};
