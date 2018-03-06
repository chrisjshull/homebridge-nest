/**
 * Created by kraig on 3/11/16.
 */

var inherits = require('util').inherits;
var Service, Characteristic;
var NestDeviceAccessory = require('./nest-device-accessory')();

'use strict';

module.exports = function(exportedTypes) {
    if (exportedTypes && !Service) {
        Service = exportedTypes.Service;
        Characteristic = exportedTypes.Characteristic;

        var acc = NestCamAccessory.prototype;
        inherits(NestCamAccessory, NestDeviceAccessory);
        NestCamAccessory.prototype.parent = NestDeviceAccessory.prototype;
        for (var mn in acc) {
            NestCamAccessory.prototype[mn] = acc[mn];
        }

        NestCamAccessory.deviceType = 'cam';
        NestCamAccessory.deviceGroup = 'cameras';
        NestCamAccessory.prototype.deviceType = NestCamAccessory.deviceType;
        NestCamAccessory.prototype.deviceGroup = NestCamAccessory.deviceGroup;
    }
    return NestCamAccessory;
};

function NestCamAccessory(conn, log, device, structure) {
    NestDeviceAccessory.call(this, conn, log, device, structure);

    var motionSvc = this.addService(Service.MotionSensor);
    this.bindCharacteristic(motionSvc, Characteristic.MotionDetected, "Motion",
        getMotionDetectionState.bind(this), null, formatMotionDetectionState.bind(this));

    this.addAwayCharacteristic(motionSvc);

    var homeService = this.addService(Service.Switch, "Home Occupied", "home_occupied");
    this.bindCharacteristic(homeService, Characteristic.On, "Home Occupied", this.getHome, this.setHome);

    this.updateData();
}


// --- MotionDetectionState ---

var getMotionDetectionState = function() {
    return this.device.last_event &&
        this.device.last_event.has_motion &&
        !this.device.last_event.end_time;
};

var formatMotionDetectionState = function(val) {
    if (val) {
        return "detected";
    } else {
        return "not detected";
    }
};

NestCamAccessory.prototype.getHome = function () {
  switch (this.structure.away) {
    case "home":
      return true;
    case "away":
    default:
      return false;
  }
};

NestCamAccessory.prototype.setHome = function (home, callback) {
    var val = !home ? 'away' : 'home';
    this.log.info("Setting Home for " + this.name + " to: " + val);
    var promise = this.conn.update(this.getStructurePropertyPath("away"), val);
    return promise
      .return(home)
      .asCallback(callback);
};
