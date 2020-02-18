/**
 * Created by Adrian Cable on 11/27/19.
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
        const acc = NestLockAccessory.prototype;
        inherits(NestLockAccessory, NestDeviceAccessory);
        NestLockAccessory.prototype.parent = NestDeviceAccessory.prototype;
        for (const mn in acc) {
            NestLockAccessory.prototype[mn] = acc[mn];
        }

        NestLockAccessory.deviceType = 'lock';
        NestLockAccessory.deviceGroup = 'locks';
        NestLockAccessory.deviceDesc = 'Nest x Yale Lock';
        NestLockAccessory.prototype.deviceType = NestLockAccessory.deviceType;
        NestLockAccessory.prototype.deviceGroup = NestLockAccessory.deviceGroup;
        NestLockAccessory.prototype.deviceDesc = NestLockAccessory.deviceDesc;
    }
    return NestLockAccessory;
};

function NestLockAccessory(conn, log, device, structure, platform) {
    NestDeviceAccessory.call(this, conn, log, device, structure, platform);

    const lockService = this.addService(Service.LockMechanism, this.homeKitSanitize(this.device.name + ' Lock'), 'lock.' + this.device.device_id);
    this.bindCharacteristic(lockService, Characteristic.LockCurrentState, 'Locked (Current)', this.getLocked);
    this.bindCharacteristic(lockService, Characteristic.LockTargetState, 'Locked (Target)', this.getLockedTarget, this.setLocked);

    lockService.addOptionalCharacteristic(Characteristic.StatusLowBattery);
    this.bindCharacteristic(lockService, Characteristic.StatusLowBattery, 'Battery Status', this.getBatteryStatus);

    this.updateData();
}

NestLockAccessory.prototype.getLocked = function () {
    return this.device.bolt_locked ? Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED;
};

NestLockAccessory.prototype.getLockedTarget = function () {
    return (this.device.bolt_moving ? this.device.bolt_moving_to : this.device.bolt_locked) ? Characteristic.LockTargetState.SECURED : Characteristic.LockTargetState.UNSECURED;
};

NestLockAccessory.prototype.setLocked = function (val, callback) {
    let cmd = {
        traitLabel: 'bolt_lock',
        command: {
            type_url: 'type.nestlabs.com/weave.trait.security.BoltLockTrait.BoltLockChangeRequest',
            value: {
                state: val ? 'BOLT_STATE_EXTENDED' : 'BOLT_STATE_RETRACTED',
                boltLockActor: {
                    method: 'BOLT_LOCK_ACTOR_METHOD_REMOTE_USER_EXPLICIT',
                    originator: { resourceId: this.device.user_id },
                    agent: null
                }
            }
            /* expiryTime: {
                seconds: (Date.now() / 1000) + 1000,
                nanos: 0
            } */
        }
    };

    this.device.bolt_moving = true;
    this.device.bolt_moving_to = val;
    return this.conn.protobufSendCommand([ cmd ], 'DEVICE_' + this.device.device_id).asCallback(callback);
};

NestLockAccessory.prototype.getBatteryStatus = function() {
    if (this.device.battery_status == 'BATTERY_REPLACEMENT_INDICATOR_NOT_AT_ALL') {
        return Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    } else if (this.device.battery_status == 'BATTERY_REPLACEMENT_INDICATOR_SOON' || this.device.battery_status == 'BATTERY_REPLACEMENT_INDICATOR_IMMEDIATELY') {
        return Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    } else {
        return null;
    }
};
