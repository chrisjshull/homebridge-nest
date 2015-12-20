/**
 * Created by kraigm on 12/15/15.
 */

var inherits = require('util').inherits;
var Accessory, Service, Characteristic, Away, uuid;

'use strict';

module.exports = function(exportedTypes) {
	if (exportedTypes && !Accessory) {
		Accessory = exportedTypes.Accessory;
		Service = exportedTypes.Service;
		Characteristic = exportedTypes.Characteristic;
		uuid = exportedTypes.uuid;
		Away = exportedTypes.Away;

		var acc = NestThermostatAccessory.prototype;
		inherits(NestThermostatAccessory, Accessory);
		NestThermostatAccessory.prototype.parent = Accessory.prototype;
		for (var mn in acc) {
			NestThermostatAccessory.prototype[mn] = acc[mn];
		}
	}
	return NestThermostatAccessory;
};

function NestThermostatAccessory(conn, log, device, structure) {

	// device info
	this.conn = conn;
	this.name = device.name;
	this.deviceId = device.device_id;
	this.log = log;
	this.device = device;
	this.structure = structure;
	this.structureId = structure.structure_id;

	var id = uuid.generate('nest.thermostat.' + this.deviceId);
	Accessory.call(this, this.name, id);
	this.uuid_base = id;

	this.getService(Service.AccessoryInformation)
		.setCharacteristic(Characteristic.Manufacturer, "Nest");

	var thermostatService = this.addService(Service.Thermostat);

	this.boundCharacteristics = [];
	var bindCharacteristic = function(characteristic, desc, getFunc, setFunc, format) {
		var actual = thermostatService.getCharacteristic(characteristic)
			.on('get', function (callback) {
				var val = getFunc.bind(this)();
				if (callback) callback(null, val);
			}.bind(this))
			.on('change', function(change) {
				var disp = change.newValue;
				if (format && disp) {
					disp = format(disp);
				}
				this.log(desc + " for " + this.name + " is: " + disp);
			}.bind(this));
		if (setFunc) {
			actual.on('set', setFunc.bind(this));
		}
		this.boundCharacteristics.push(characteristic);
	}.bind(this);

	bindCharacteristic(Characteristic.TemperatureDisplayUnits, "Temperature unit", this.getTemperatureUnits, null, function(val){
		return val == Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? "Fahrenheit" : "Celsius";
	});

	bindCharacteristic(Characteristic.CurrentTemperature, "Current temperature", this.getCurrentTemperature);
	bindCharacteristic(Characteristic.CurrentHeatingCoolingState, "Current heating", this.getCurrentHeatingCooling);
	bindCharacteristic(Characteristic.CurrentRelativeHumidity, "Current humidity", this.getCurrentRelativeHumidity);

	bindCharacteristic(Characteristic.TargetTemperature, "Target temperature", this.getTargetTemperature, this.setTargetTemperature);
	bindCharacteristic(Characteristic.TargetHeatingCoolingState, "Target heating", this.getTargetHeatingCooling, this.setTargetHeatingCooling);

	thermostatService.addCharacteristic(Away);
	bindCharacteristic(Away, "Away", this.isAway, this.setAway);

	this.updateData();
}

NestThermostatAccessory.prototype.getServices = function () {
	return this.services;
};

NestThermostatAccessory.prototype.updateData = function (device, structure) {
	if (device) {
		this.device = device;
	}
	if (structure) {
		this.structure = structure;
	}
	var thermostat = this.getService(Service.Thermostat);
	this.boundCharacteristics.map(function(c){
		thermostat.getCharacteristic(c).getValue();
	});
};

NestThermostatAccessory.prototype.getCurrentHeatingCooling = function () {
	switch (this.device.hvac_state) {
		case "off":
			return Characteristic.CurrentHeatingCoolingState.OFF;
		case "heating":
			return Characteristic.CurrentHeatingCoolingState.HEAT;
		case "cooling":
			return Characteristic.CurrentHeatingCoolingState.COOL;
		default:
			return Characteristic.CurrentHeatingCoolingState.OFF;
	}
};

NestThermostatAccessory.prototype.getTargetHeatingCooling = function () {
	switch (this.device.hvac_mode) {
		case "off":
			return Characteristic.CurrentHeatingCoolingState.OFF;
		case "heat":
			return Characteristic.CurrentHeatingCoolingState.HEAT;
		case "cool":
			return Characteristic.CurrentHeatingCoolingState.COOL;
		case "heat-cool":
			return Characteristic.CurrentHeatingCoolingState.HEAT | Characteristic.CurrentHeatingCoolingState.COOL;
		default:
			return Characteristic.CurrentHeatingCoolingState.OFF;
	}
};

NestThermostatAccessory.prototype.isAway = function () {
	switch (this.structure.away) {
		case "home":
			return false;
		case "away":
			return true;
		case "auto-away":
			//TODO: Find a way to determine current state
			return false;
		default:
			return false;
	}
};

NestThermostatAccessory.prototype.getCurrentTemperature = function () {
	switch (this.device.temperature_scale) {
		case "F":
			return fahrenheitToCelsius(this.device.ambient_temperature_f);
		case "C":
			return this.device.ambient_temperature_c;
		default:
			return this.device.ambient_temperature_c;
	}
};

NestThermostatAccessory.prototype.getCurrentRelativeHumidity = function () {
	return this.device.humidity;
};

NestThermostatAccessory.prototype.getTargetTemperature = function () {
	switch (this.getTargetHeatingCooling()) {
		case Characteristic.CurrentHeatingCoolingState.HEAT | Characteristic.CurrentHeatingCoolingState.COOL:
			// Choose closest target as single target
			if (this.device.temperature_scale = "F") {
				var high = fahrenheitToCelsius(this.device.target_temperature_high_f);
				var low = fahrenheitToCelsius(this.device.target_temperature_low_f);
			} else {
				var high = this.device.target_temperature_high_c;
				var low = this.device.target_temperature_low_c;
			}
			var cur = this.getCurrentTemperature();
			return Math.abs(high - cur) < Math.abs(cur - low) ? high : low;
		default:
			if (this.device.temperature_scale = "F") {
				return fahrenheitToCelsius(this.device.target_temperature_f);
			} else {
				return this.device.target_temperature_c;
			}
			
	}
};

NestThermostatAccessory.prototype.getTemperatureUnits = function () {
	switch (this.device.temperature_scale) {
		case "F":
			return Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
		case "C":
			return Characteristic.TemperatureDisplayUnits.CELSIUS;
		default:
			return Characteristic.TemperatureDisplayUnits.CELSIUS;
	}
};

var getThermostatPath = function(deviceId, property){
	return 'devices/thermostats/' + deviceId + '/' + property;
};

var getStructurePath = function(deviceId, property){
	return 'structures/' + deviceId + '/' + property;
};

var callbackPromise = function(promise, callback, val){
	promise
		.then(function(){
			callback(null, val);
		})
		.catch(function(err){
			callback(err);
		});
};

function fahrenheitToCelsius(temperature) {
	return (temperature - 32) / 1.8
}

function celsiusToFahrenheit(temperature) {
	return (temperature * 1.8) + 32
}

NestThermostatAccessory.prototype.setTargetHeatingCooling = function (targetHeatingCooling, callback) {
	var val = null;

	switch (targetHeatingCooling) {
		case Characteristic.CurrentHeatingCoolingState.HEAT:
			val = 'heat';
			break;
		case Characteristic.CurrentHeatingCoolingState.COOL:
			val = 'cool';
			break;
		case Characteristic.CurrentHeatingCoolingState.HEAT | Characteristic.CurrentHeatingCoolingState.COOL:
			val = 'heat-cool';
			break;
		default:
			val = 'off';
			break;
	}

	this.log("Setting target heating cooling for " + this.name + " to: " + val);
	var promise = this.conn.update(getThermostatPath(this.deviceId, "hvac_mode"), val);

	if (callback) callbackPromise(promise, callback, val);
	else return promise;
};

NestThermostatAccessory.prototype.setTargetTemperature = function (targetTemperature, callback) {
	var promise;

	targetTemperatureF = Math.round(celsiusToFahrenheit(targetTemperature))
	// Value has to be in half point increments
	targetTemperature = Math.round( targetTemperature * 2 ) / 2;


	switch (this.getTargetHeatingCooling()) {
		case Characteristic.CurrentHeatingCoolingState.HEAT | Characteristic.CurrentHeatingCoolingState.COOL:
			// Choose closest target as single target
			if (this.device.temperature_scale = "F") {
				var high = fahrenheitToCelsius(this.device.target_temperature_high_f);
				var low = fahrenheitToCelsius(this.device.target_temperature_low_f);
			} else {
				var high = this.device.target_temperature_high_c;
				var low = this.device.target_temperature_low_c;
			}
			var cur = this.getCurrentTemperature();
			var isHighTemp = Math.abs(high - cur) < Math.abs(cur - low);
			var prop = isHighTemp ? "high" : "low";
			this.log("Setting " + prop + " target temperature for " + this.name + " to: " + targetTemperature);
			if (this.device.temperature_scale = "F") {
				promise = this.conn.update(getThermostatPath(this.deviceId, "target_temperature_f"), targetTemperatureF);
			} else {
				promise = this.conn.update(getThermostatPath(this.deviceId, "target_temperature_c"), targetTemperature);
			}
			break;
		default:
			this.log("Setting target temperature for " + this.name + " to: " + targetTemperature);
			if (this.device.temperature_scale = "F") {
				promise = this.conn.update(getThermostatPath(this.deviceId, "target_temperature_f"), targetTemperatureF);
			} else {
				promise = this.conn.update(getThermostatPath(this.deviceId, "target_temperature_c"), targetTemperature);
			}
			break;
	}

	if (callback) callbackPromise(promise, callback, targetTemperature);
	else return promise;
};

NestThermostatAccessory.prototype.setAway = function (away, callback) {
	var val = away ? 'away' : 'home';
	this.log("Setting Away for " + this.name + " to: " + val);
	var promise = this.conn.update(getStructurePath(this.structureId, "away"), val);

	if (callback) callbackPromise(promise, callback, away);
	else return promise;
};
