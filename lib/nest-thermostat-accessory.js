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

	// Only allow 0.5 increments for Celsius temperatures. HomeKit is already limited to 1-degree increments in Fahrenheit,
	// and setting this value for Fahrenheit will cause HomeKit to incorrectly round values when converting from °F to °C and back.
	if (!this.usesFahrenheit()) {
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
	}
	bindCharacteristic(Characteristic.TargetTemperature, "Target temperature", this.getTargetTemperature, this.setTargetTemperature, formatAsDisplayTemperature);
	bindCharacteristic(Characteristic.TargetHeatingCoolingState, "Target heating/cooling state", this.getTargetHeatingCooling, this.setTargetHeatingCooling, formatTargetHeatingCoolingState);

	bindCharacteristic(Characteristic.CoolingThresholdTemperature, "Cooling threshold temperature", this.getCoolingThresholdTemperature, this.setCoolingThresholdTemperature, formatAsDisplayTemperature);
	bindCharacteristic(Characteristic.HeatingThresholdTemperature, "Heating threshold temperature", this.getHeatingThresholdTemperature, this.setHeatingThresholdTemperature, formatAsDisplayTemperature);

	if (this.device.has_fan) {
		var thermostatFanService = this.addService(Service.Fan);
		var formatFanState = function (val) {
			if (val) {
				return "On";
			}
			return "Off";
		};
		this.bindCharacteristic(thermostatFanService, Characteristic.On, "Fan State", this.getFanState, this.setFanState, formatFanState);
	}

	var homeService = this.addService(Service.Switch, "Home Occupied", "home_occupied");
	this.bindCharacteristic(homeService, Characteristic.On, "Home Occupied", this.getHome, this.setHome);

	var thermostatEcoModeService = this.addService(Service.Switch, "Eco Mode", "eco_mode");
	this.bindCharacteristic(thermostatEcoModeService, Characteristic.On, "Eco Mode", this.getEcoMode, this.setEcoMode);

  // Add custom characteristics

	this.addAwayCharacteristic(thermostatService); // legacy: now exposed as a Switch
	this.addEcoModeCharacteristic(thermostatService); // legacy: now exposed as a Switch

	if (this.device.has_fan === true) { // legacy: now exposed as a Fan
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
	this.log('getTargetTemperature', this.device.target_temperature_c);
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

// todo: why does this sometimes reset while dragging? (change event coming in while new change queued?)
NestThermostatAccessory.prototype.setTargetTemperatureDebounced = debounce(function (targetTemperature, callback) {
	switch (this.device.hvac_mode) {
		case "heat-cool":
			return;
		case "eco":
			return;
		default:
			return Promise.resolve()
				.then(this.updateTargetWithCorrectUnitsAsync("target_temperature_", targetTemperature, "target temperature"))
				.asCallback(callback);
	}
}, 5000);

NestThermostatAccessory.prototype.setCoolingThresholdTemperatureDebounced = debounce(function (targetTemperature, callback) {
	switch (this.device.hvac_mode) {
		case "heat-cool":
			return Promise.resolve()
				.then(this.updateTargetWithCorrectUnitsAsync("target_temperature_high_", targetTemperature, "cooling threshold temperature"))
				.asCallback(callback);
		default:
			return;
	}
}, 5000);

NestThermostatAccessory.prototype.setHeatingThresholdTemperatureDebounced = debounce(function (targetTemperature, callback) {
	switch (this.device.hvac_mode) {
		case "heat-cool":
			return Promise.resolve()
				.then(this.updateTargetWithCorrectUnitsAsync("target_temperature_low_", targetTemperature, "heating threshold temperature"))
				.asCallback(callback);
		default:
			return;
	}
}, 5000);

NestThermostatAccessory.prototype.updateTargetWithCorrectUnitsAsync = function (key, celcius, str) {
	var usesFahrenheit = this.usesFahrenheit();
	key += (usesFahrenheit ? "f" : "c");
	var targetTemperature = usesFahrenheit ? Math.round(celsiusToFahrenheit(celcius)) : celcius;
	return this.updateDevicePropertyAsync.bind(this, key, targetTemperature, str);
};

NestThermostatAccessory.prototype.getFanState = function () {
	return this.device.fan_timer_active;
};

NestThermostatAccessory.prototype.setFanState = function (targetFanState, callback) {
	this.log("Setting target fan state for " + this.name + " to: " + targetFanState);

	return this.updateDevicePropertyAsync("fan_timer_active", !!targetFanState, "fan enable/disable")
		.asCallback(callback);
};

NestThermostatAccessory.prototype.getHome = function () {
  switch (this.structure.away) {
    case "home":
      return true;
    case "away":
    default:
      return false;
  }
};

NestDeviceAccessory.prototype.setHome = function (home, callback) {
    var val = !home ? 'away' : 'home';
    this.log.info("Setting Home for " + this.name + " to: " + val);
    var promise = this.conn.update(this.getStructurePropertyPath("away"), val);
    return promise
      .return(home)
      .asCallback(callback);
};

NestThermostatAccessory.prototype.getEcoMode = function () {
  return (this.device.hvac_mode === "eco");
};

NestThermostatAccessory.prototype.setEcoMode = function (eco, callback) {
  var val = eco ? 'eco' : this.device.previous_hvac_mode;
  this.log.info("Setting Eco Mode for " + this.name + " to: " + val);
	return this.updateDevicePropertyAsync("hvac_mode", val, "target heating cooling")
		.asCallback(callback);
};
