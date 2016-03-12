/**
 * Created by kraigm on 12/15/15.
 */

var inherits = require('util').inherits;
var Accessory, Service, Characteristic, Away, uuid;
var NestDeviceAccessory = require('./nest-device-accessory')();

'use strict';

module.exports = function(exportedTypes) {
	if (exportedTypes && !Accessory) {
		Accessory = exportedTypes.Accessory;
		Service = exportedTypes.Service;
		Characteristic = exportedTypes.Characteristic;
		uuid = exportedTypes.uuid;
		Away = exportedTypes.Away;

		var acc = NestThermostatAccessory.prototype;
		inherits(NestThermostatAccessory, NestDeviceAccessory);
		NestThermostatAccessory.prototype.parent = NestDeviceAccessory.prototype;
		for (var mn in acc) {
			NestThermostatAccessory.prototype[mn] = acc[mn];
		}

		NestThermostatAccessory.deviceType = 'thermostat';
		NestThermostatAccessory.deviceGroup = 'thermostats';
		NestThermostatAccessory.prototype.deviceType = NestThermostatAccessory.deviceType;
		NestThermostatAccessory.prototype.deviceGroup = NestThermostatAccessory.deviceGroup;
	}
	return NestThermostatAccessory;
};

function NestThermostatAccessory(conn, log, device, structure) {

	NestDeviceAccessory.call(this, conn, log, device, structure);

	var thermostatService = this.addService(Service.Thermostat);

	var formatAsDisplayTemperature = function(t) {
		return this.usesFahrenheit() ? celsiusToFahrenheit(t) + " F" : t + " C";
	}.bind(this);

	var formatHeatingCoolingState = function (val) {
		switch (val) {
			case Characteristic.CurrentHeatingCoolingState.OFF:
				return "Off";
			case Characteristic.CurrentHeatingCoolingState.HEAT:
				return "Heating";
			case Characteristic.CurrentHeatingCoolingState.COOL:
				return "Cooling";
			case Characteristic.CurrentHeatingCoolingState.HEAT | Characteristic.CurrentHeatingCoolingState.COOL:
				return "Heating/Cooling";
		}
	};

	var bindCharacteristic = function (characteristic, desc, getFunc, setFunc, format) {
		this.bindCharacteristic(thermostatService, characteristic, desc, getFunc, setFunc, format);
	}.bind(this);

	bindCharacteristic(Characteristic.TemperatureDisplayUnits, "Temperature unit", this.getTemperatureUnits, null, function (val) {
		return val == Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? "Fahrenheit" : "Celsius";
	});

	bindCharacteristic(Characteristic.CurrentTemperature, "Current temperature", this.getCurrentTemperature, null, formatAsDisplayTemperature);
	bindCharacteristic(Characteristic.CurrentHeatingCoolingState, "Current heating", this.getCurrentHeatingCooling, null, formatHeatingCoolingState);
	bindCharacteristic(Characteristic.CurrentRelativeHumidity, "Current humidity", this.getCurrentRelativeHumidity, null, function(val) {
		return val + "%";
	});

	bindCharacteristic(Characteristic.TargetTemperature, "Target temperature", this.getTargetTemperature, this.setTargetTemperature, formatAsDisplayTemperature);
	bindCharacteristic(Characteristic.TargetHeatingCoolingState, "Target heating", this.getTargetHeatingCooling, this.setTargetHeatingCooling, formatHeatingCoolingState);

	thermostatService.addCharacteristic(Away);
	bindCharacteristic(Away, "Away", this.isAway, this.setAway);

	this.updateData();
}

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

NestThermostatAccessory.prototype.getCurrentTemperature = function () {
	if (this.usesFahrenheit()) {
		return fahrenheitToCelsius(this.device.ambient_temperature_f);
	} else {
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
			var high, low;
			if (this.usesFahrenheit()) {
				high = fahrenheitToCelsius(this.device.target_temperature_high_f);
				low = fahrenheitToCelsius(this.device.target_temperature_low_f);
			} else {
				high = this.device.target_temperature_high_c;
				low = this.device.target_temperature_low_c;
			}
			var cur = this.getCurrentTemperature();
			return Math.abs(high - cur) < Math.abs(cur - low) ? high : low;
		default:
			if (this.usesFahrenheit()) {
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

function fahrenheitToCelsius(temperature) {
	return (temperature - 32) / 1.8;
}

function celsiusToFahrenheit(temperature) {
	return (temperature * 1.8) + 32;
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

	return this.updateDevicePropertyAsync("hvac_mode", val, "target heating cooling")
		.asCallback(callback);
};

NestThermostatAccessory.prototype.setTargetTemperature = function (targetTemperature, callback) {
	var usesFahrenheit = this.usesFahrenheit();
	if (usesFahrenheit) {
		// Convert to Fahrenheit and round to nearest integer
		targetTemperature = Math.round(celsiusToFahrenheit(targetTemperature));
	} else {
		// Celsius value has to be in half point increments
		targetTemperature = Math.round( targetTemperature * 2 ) / 2;
	}

	var key = "target_temperature_";
	var prop = "";
	if (this.getTargetHeatingCooling() == (Characteristic.CurrentHeatingCoolingState.HEAT | Characteristic.CurrentHeatingCoolingState.COOL)) {
		// Choose closest target as single target
		var high, low;
		if (usesFahrenheit) {
			high = fahrenheitToCelsius(this.device.target_temperature_high_f);
			low = fahrenheitToCelsius(this.device.target_temperature_low_f);
		} else {
			high = this.device.target_temperature_high_c;
			low = this.device.target_temperature_low_c;
		}
		var cur = this.getCurrentTemperature();
		var isHighTemp = Math.abs(high - cur) < Math.abs(cur - low);
		prop = isHighTemp ? "high" : "low";
		key += prop + "_";
		prop += " ";
	}

	key += (usesFahrenheit ? "f" : "c");

	return this.cancelAutoAway()
		.then(this.updateDevicePropertyAsync.bind(this, key, targetTemperature, prop + "target temperature"))
		.asCallback(callback);
};

NestThermostatAccessory.prototype.usesFahrenheit = function () {
	return this.getTemperatureUnits() == Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
};
