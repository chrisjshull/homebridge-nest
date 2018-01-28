
var Promise = require('bluebird');
var inherits = require('util').inherits;
var Accessory, Service, Characteristic, uuid;
var NestDeviceAccessory = require('./nest-device-accessory')();

'use strict';

module.exports = function(exportedTypes) {
	if (exportedTypes && !Accessory) {
		Accessory = exportedTypes.Accessory;
		Service = exportedTypes.Service;
		Characteristic = exportedTypes.Characteristic;
		uuid = exportedTypes.uuid;

		var acc = NestStructureAccessory.prototype;
		inherits(NestStructureAccessory, NestDeviceAccessory);
		NestStructureAccessory.prototype.parent = NestDeviceAccessory.prototype;
		for (var mn in acc) {
			NestStructureAccessory.prototype[mn] = acc[mn];
		}

		NestStructureAccessory.deviceType = 'structure';
		NestStructureAccessory.deviceGroup = 'structures';
		NestStructureAccessory.prototype.deviceType = NestStructureAccessory.deviceType;
		NestStructureAccessory.prototype.deviceGroup = NestStructureAccessory.deviceGroup;
	}
	return NestStructureAccessory;
};

function NestStructureAccessory(conn, log, device, structure) {

	NestDeviceAccessory.call(this, conn, log, device, structure);

	var homeService = this.addService(Service.Switch);
	this.bindCharacteristic(homeService, Characteristic.On, "Home State", this.isAway, this.setHome);

	this.updateData();
}

NestDeviceAccessory.prototype.setHome = function (home, callback) {
    var val = !home ? 'away' : 'home';
    this.log.info("Setting Away/Home for " + this.name + " to: " + val);
    var promise = this.conn.update(this.getStructurePropertyPath("away"), val);
    return promise
        .return(away)
        .asCallback(callback);
};

NestDeviceAccessory.prototype.addAwayCharacteristic = function(service) {
    service.addCharacteristic(Away);
    this.bindCharacteristic(service, Away, "Away", this.isAway, this.setAway);
};

NestDeviceAccessory.prototype.isAway = function () {
    switch (this.structure.away) {
        case "home":
            return false;
        case "away":
            return true
        default:
            return false;
    }
};
