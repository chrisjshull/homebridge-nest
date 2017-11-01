/**
 * Created by kraigm on 12/15/15.
 */

var Promise = require('bluebird');
var debounce = require('lodash.debounce');
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
		return t + " °C and " + celsiusToFahrenheit(t) + " °F";
	}.bind(this);

	var formatCurrentHeatingCoolingState = function (val) {
		switch (val) {
			case Characteristic.CurrentHeatingCoolingState.OFF:
				return "Off";
			case Characteristic.CurrentHeatingCoolingState.HEAT:
				return "Heating";
			case Characteristic.CurrentHeatingCoolingState.COOL:
				return "Cooling";
		}
	};

	var formatTargetHeatingCoolingState = function (val) {
		switch (val) {
			case Characteristic.TargetHeatingCoolingState.OFF:
				return "Off";
			case Characteristic.TargetHeatingCoolingState.HEAT:
				return "Heat";
			case Characteristic.TargetHeatingCoolingState.COOL:
				return "Cool";
			case Characteristic.TargetHeatingCoolingState.AUTO:
				return "Auto";
		}
	};

	var bindCharacteristic = function (characteristic, desc, getFunc, setFunc, format) {
		this.bindCharacteristic(thermostatService, characteristic, desc, getFunc, setFunc, format);
	}.bind(this);

	bindCharacteristic(Characteristic.TemperatureDisplayUnits, "Temperature unit", this.getTemperatureUnits, this.setTemperatureUnits, function (val) {
		return val == Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? "Fahrenheit" : "Celsius";
	});

	bindCharacteristic(Characteristic.CurrentTemperature, "Current temperature", this.getCurrentTemperature, null, formatAsDisplayTemperature);
	bindCharacteristic(Characteristic.CurrentHeatingCoolingState, "Current heating/cooling state", this.getCurrentHeatingCooling, null, formatCurrentHeatingCoolingState);
	bindCharacteristic(Characteristic.CurrentRelativeHumidity, "Current humidity", this.getCurrentRelativeHumidity, null, function(val) {
		return val + "%";
	});

	thermostatService.getCharacteristic(Characteristic.CurrentTemperature)
		.setProps({
			minStep: 0.5
		});
	thermostatService.getCharacteristic(Characteristic.TargetTemperature)
		.setProps({
			minStep: 0.5
		});
	thermostatService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
		.setProps({
			minStep: 0.5
		});
	thermostatService.getCharacteristic(Characteristic.HeatingThresholdTemperature)
		.setProps({
			minStep: 0.5
		});
	bindCharacteristic(Characteristic.TargetTemperature, "Target temperature", this.getTargetTemperature, this.setTargetTemperature, formatAsDisplayTemperature);
	bindCharacteristic(Characteristic.TargetHeatingCoolingState, "Target heating/cooling state", this.getTargetHeatingCooling, this.setTargetHeatingCooling, formatTargetHeatingCoolingState);

	bindCharacteristic(Characteristic.CoolingThresholdTemperature, "Cooling threshold temperature", this.getCoolingThresholdTemperature, this.setCoolingThresholdTemperature, formatAsDisplayTemperature);
	bindCharacteristic(Characteristic.HeatingThresholdTemperature, "Heating threshold temperature", this.getHeatingThresholdTemperature, this.setHeatingThresholdTemperature, formatAsDisplayTemperature);


// Add custom characteristics

	this.addAwayCharacteristic(thermostatService);

	this.addEcoModeCharacteristic(thermostatService);

	if (this.device.has_fan === true) {
		this.addFanTimerActiveCharacteristic(thermostatService);
		this.addFanTimerDurationCharacteristic(thermostatService);
	}

	this.addHasLeafCharacteristic(thermostatService);

	this.addSunlightCorrectionEnabledCharacteristic(thermostatService);

	this.addSunlightCorrectionActiveCharacteristic(thermostatService);

	this.addUsingEmergencyHeatCharacteristic(thermostatService);

	this.updateData();
}

function fahrenheitToCelsius(temperature) {
	return (temperature - 32) / 1.8;
}

function celsiusToFahrenheit(temperature) {
	return (temperature * 1.8) + 32;
}

NestThermostatAccessory.prototype.usesFahrenheit = function () {
	return this.getTemperatureUnits() == Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
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
			return Characteristic.TargetHeatingCoolingState.OFF;
		case "heat":
			return Characteristic.TargetHeatingCoolingState.HEAT;
		case "cool":
			return Characteristic.TargetHeatingCoolingState.COOL;
		case "heat-cool":
			return Characteristic.TargetHeatingCoolingState.AUTO;
		case "eco":
			return Characteristic.TargetHeatingCoolingState.AUTO;
		default:
			return Characteristic.TargetHeatingCoolingState.OFF;
	}
};

NestThermostatAccessory.prototype.getCurrentTemperature = function () {
	return this.device.ambient_temperature_c;
};

NestThermostatAccessory.prototype.getCurrentRelativeHumidity = function () {
	return this.device.humidity;
};

NestThermostatAccessory.prototype.getTargetTemperature = function () {
	switch (this.device.hvac_mode) {
		case "heat-cool":
			return 10;
		case "eco":
			return 10;
		default:
			return this.device.target_temperature_c;
	}
};

NestThermostatAccessory.prototype.getCoolingThresholdTemperature = function () {
	switch (this.device.hvac_mode) {
		case "heat-cool":
			return this.device.target_temperature_high_c;
		case "eco":
			return this.device.eco_temperature_high_c;
		default:
			return 10;
	}
};

NestThermostatAccessory.prototype.getHeatingThresholdTemperature = function () {
	switch (this.device.hvac_mode) {
		case "heat-cool":
			return this.device.target_temperature_low_c;
		case "eco":
			return this.device.eco_temperature_low_c;
		default:
			return 0;
	}
};

NestThermostatAccessory.prototype.getTemperatureUnits = function () {
	switch (this.device.temperature_scale) {
		case "C":
			return Characteristic.TemperatureDisplayUnits.CELSIUS;
		case "F":
			return Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
		default:
			return Characteristic.TemperatureDisplayUnits.CELSIUS;
	}
};

NestThermostatAccessory.prototype.setTemperatureUnits = function (temperatureUnits, callback) {
	var val = null;

	switch (temperatureUnits) {
		case Characteristic.TemperatureDisplayUnits.CELSIUS:
			val = 'C';
			break;
		case Characteristic.TemperatureDisplayUnits.FAHRENHEIT:
			val = 'F';
			break;
		default:
			val = 'C';
			break;
	}

	return this.updateDevicePropertyAsync("temperature_scale", val, "temperature display units")
		.asCallback(callback);
};

NestThermostatAccessory.prototype.setTargetHeatingCooling = function (targetHeatingCooling, callback) {
	var val = null;

	switch (targetHeatingCooling) {
		case Characteristic.TargetHeatingCoolingState.OFF:
			val = 'off';
			break;
		case Characteristic.TargetHeatingCoolingState.HEAT:
			if (this.device.can_heat === true) {
				val = 'heat';
				break;
			} else {
				return;
			}
		case Characteristic.TargetHeatingCoolingState.COOL:
			if (this.device.can_cool === true) {
				val = 'cool';
				break;
			} else {
				return;
			}
		case Characteristic.TargetHeatingCoolingState.AUTO:
			if (this.device.can_heat === true && this.device.can_cool === true) {
				val = 'heat-cool';
				break;
			} else {
				return;
			}
		default:
			val = 'off';
			break;
	}

	return this.updateDevicePropertyAsync("hvac_mode", val, "target heating cooling")
		.asCallback(callback);
};

NestThermostatAccessory.prototype.setTargetTemperature = function(targetTemperature, callback) {
	this.log('Trying to set temperature ' + targetTemperature);
	this.setTargetTemperatureDebounced(targetTemperature, function() {
		this.log('Temperature set to ' + targetTemperature);
	}.bind(this));
	return Promise.resolve().asCallback(callback);
};

NestThermostatAccessory.prototype.setCoolingThresholdTemperature = function(targetTemperature, callback) {
	this.log('Trying to set cooling threshold temperature ' + targetTemperature);
	this.setCoolingThresholdTemperatureDebounced(targetTemperature, function() {
		this.log('Cooling threshold temperature set to ' + targetTemperature);
	}.bind(this));
	return Promise.resolve().asCallback(callback);
};

NestThermostatAccessory.prototype.setHeatingThresholdTemperature = function(targetTemperature, callback) {
	this.log('Trying to set heating threshold temperature ' + targetTemperature);
	this.setHeatingThresholdTemperatureDebounced(targetTemperature, function() {
		this.log('Heating threshold temperature set to ' + targetTemperature);
	}.bind(this));
	return Promise.resolve().asCallback(callback);
};

NestThermostatAccessory.prototype.setTargetTemperatureDebounced = debounce(function (targetTemperature, callback) {
	switch (this.device.hvac_mode) {
		case "heat-cool":
			return;
		case "eco":
			return;
		default:
			return this.updateDevicePropertyAsync.bind(this, "target_temperature_c", targetTemperature, "target temperature");
	}
}, 5000);

NestThermostatAccessory.prototype.setCoolingThresholdTemperatureDebounced = debounce(function (targetTemperature, callback) {
	switch (this.device.hvac_mode) {
		case "heat-cool":
			return this.updateDevicePropertyAsync.bind(this, "target_temperature_high_c", targetTemperature, "cooling threshold temperature");
		default:
			return;
	}
}, 5000);

NestThermostatAccessory.prototype.setHeatingThresholdTemperatureDebounced = debounce(function (targetTemperature, callback) {
	switch (this.device.hvac_mode) {
		case "heat-cool":
			return this.updateDevicePropertyAsync.bind(this, "target_temperature_low_c", targetTemperature, "heating threshold temperature");
		default:
			return;
	}
}, 5000);
