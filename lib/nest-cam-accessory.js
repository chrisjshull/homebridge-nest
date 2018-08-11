/**
 * Created by kraig on 3/11/16.
 */

const inherits = require('util').inherits;
let Service, Characteristic;
const NestDeviceAccessory = require('./nest-device-accessory')();

'use strict';

module.exports = function(exportedTypes) {
  if (exportedTypes && !Service) {
    Service = exportedTypes.Service;
    Characteristic = exportedTypes.Characteristic;

    const acc = NestCamAccessory.prototype;
    inherits(NestCamAccessory, NestDeviceAccessory);
    NestCamAccessory.prototype.parent = NestDeviceAccessory.prototype;
    for (const mn in acc) {
      NestCamAccessory.prototype[mn] = acc[mn];
    }

    NestCamAccessory.deviceType = 'cam';
    NestCamAccessory.deviceGroup = 'cameras';
    NestCamAccessory.prototype.deviceType = NestCamAccessory.deviceType;
    NestCamAccessory.prototype.deviceGroup = NestCamAccessory.deviceGroup;
  }
  return NestCamAccessory;
};

function NestCamAccessory(conn, log, device, structure, platform) {
  NestDeviceAccessory.call(this, conn, log, device, structure, platform);

  const motionSvc = this.addService(Service.MotionSensor);
  this.bindCharacteristic(motionSvc, Characteristic.MotionDetected, "Motion",
    getMotionDetectionState.bind(this), null, formatMotionDetectionState.bind(this));

  this.addAwayCharacteristic(motionSvc);
  
  // If Nest Camera (Long Name) contains "Nest Hello" then create a Doorbell Service for this Accessory.
  const doorbellSvc = this.addService(Service.Doorbell);
  this.bindCharacteristic(doorbellSvc, Characteristic.ProgrammableSwitchEvent, "Doorbell",
    getDoorbellDetectionState.bind(this), null, formatDoorbellDetectionState.bind(this));
  
  this.updateData();
}


// --- MotionDetectionState ---

const getMotionDetectionState = function() {
  return this.device.last_event &&
        this.device.last_event.has_motion &&
        !this.device.last_event.end_time;
};

const formatMotionDetectionState = function(val) {
  if (val) {
    return "detected";
  } else {
    return "not detected";
  }
};

// --- DoorbellDetectionState ---

const getDoorbellDetectionState = function() {
  return this.device.last_event &&
        this.device.last_event.has_person &&
        !this.device.last_event.end_time;
};

const formatDoorbellDetectionState = function(val) {
  if (val) {
    return "true";//return "0";(Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS = 0;)
  }
};
