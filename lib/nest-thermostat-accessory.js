/**
 * Created by kraigm on 12/15/15.
 */

const Promise = require('bluebird');
const debounce = require('lodash.debounce');
const inherits = require('util').inherits;
let Accessory, Service, Characteristic; // , uuid;
const NestDeviceAccessory = require('./nest-device-accessory')();

'use strict';

module.exports = function(exportedTypes) {
  if (exportedTypes && !Accessory) {
    Accessory = exportedTypes.Accessory;
    Service = exportedTypes.Service;
    Characteristic = exportedTypes.Characteristic;
    // uuid = exportedTypes.uuid;

    const acc = NestThermostatAccessory.prototype;
    inherits(NestThermostatAccessory, NestDeviceAccessory);
    NestThermostatAccessory.prototype.parent = NestDeviceAccessory.prototype;
    for (const mn in acc) {
      NestThermostatAccessory.prototype[mn] = acc[mn];
    }

    NestThermostatAccessory.deviceType = 'thermostat';
    NestThermostatAccessory.deviceGroup = 'thermostats';
    NestThermostatAccessory.prototype.deviceType = NestThermostatAccessory.deviceType;
    NestThermostatAccessory.prototype.deviceGroup = NestThermostatAccessory.deviceGroup;
  }
  return NestThermostatAccessory;
};

function NestThermostatAccessory(conn, log, device, structure, platform) {
  NestDeviceAccessory.call(this, conn, log, device, structure, platform);

  const thermostatService = this.addService(Service.Thermostat);

  const formatAsDisplayTemperature = function(t) {
    return t + " °C and " + celsiusToFahrenheit(t) + " °F";
  };

  const formatCurrentHeatingCoolingState = function (val) {
    switch (val) {
    case Characteristic.CurrentHeatingCoolingState.OFF:
      return "Off";
    case Characteristic.CurrentHeatingCoolingState.HEAT:
      return "Heating";
    case Characteristic.CurrentHeatingCoolingState.COOL:
      return "Cooling";
    }
  };

  const formatTargetHeatingCoolingState = function (val) {
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

  const bindCharacteristic = function (characteristic, desc, getFunc, setFunc, format) {
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

  /*
   * Only allow 0.5 increments for Celsius temperatures. HomeKit is already limited to 1-degree increments in Fahrenheit,
   * and setting this value for Fahrenheit will cause HomeKit to incorrectly round values when converting from °F to °C and back.
   */
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

  if (!this.device.can_cool) {
    thermostatService.getCharacteristic(Characteristic.TargetHeatingCoolingState).setProps({validValues: [Characteristic.TargetHeatingCoolingState.OFF, Characteristic.TargetHeatingCoolingState.HEAT]});
  } else if (!this.device.can_heat) {
    thermostatService.getCharacteristic(Characteristic.TargetHeatingCoolingState).setProps({validValues: [Characteristic.TargetHeatingCoolingState.OFF, Characteristic.TargetHeatingCoolingState.COOL]});
  }

  bindCharacteristic(Characteristic.TargetTemperature, "Target temperature", this.getTargetTemperature, this.setTargetTemperature, formatAsDisplayTemperature);
  bindCharacteristic(Characteristic.TargetHeatingCoolingState, "Target heating/cooling state", this.getTargetHeatingCooling, this.setTargetHeatingCooling, formatTargetHeatingCoolingState);

  bindCharacteristic(Characteristic.CoolingThresholdTemperature, "Cooling threshold temperature", this.getCoolingThresholdTemperature, this.setCoolingThresholdTemperature, formatAsDisplayTemperature);
  bindCharacteristic(Characteristic.HeatingThresholdTemperature, "Heating threshold temperature", this.getHeatingThresholdTemperature, this.setHeatingThresholdTemperature, formatAsDisplayTemperature);

  if (this.device.has_fan && this.platform.shouldEnableFeature("Thermostat.Fan")) {
    const thermostatFanService = this.addService(Service.Fan);
    const formatFanState = function (val) {
      if (val) {
        return "On";
      }
      return "Off";
    };
    this.bindCharacteristic(thermostatFanService, Characteristic.On, "Fan State", this.getFanState, this.setFanState, formatFanState);
  }

  if (this.platform.shouldEnableFeature("Thermostat.Home")) {
    const homeService = this.addService(Service.Switch, "Home Occupied", "home_occupied");
    this.bindCharacteristic(homeService, Characteristic.On, "Home Occupied", this.getHome, this.setHome);
  }

  if (this.platform.shouldEnableFeature("Thermostat.Eco")) {
    const thermostatEcoModeService = this.addService(Service.Switch, "Eco Mode", "eco_mode");
    this.bindCharacteristic(thermostatEcoModeService, Characteristic.On, "Eco Mode", this.getEcoMode, this.setEcoMode);
  }

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

/*
 * function fahrenheitToCelsius(temperature) {
 *   return (temperature - 32) / 1.8;
 * }
 */

function celsiusToFahrenheit(temperature) {
  return (temperature * 1.8) + 32;
}

NestThermostatAccessory.prototype.usesFahrenheit = function () {
  return this.getTemperatureUnits() == Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
};

NestThermostatAccessory.prototype.getCurrentHeatingCooling = function () {
  switch (this.device.hvac_state) {
  case "heating":
    return Characteristic.CurrentHeatingCoolingState.HEAT;
  case "cooling":
    return Characteristic.CurrentHeatingCoolingState.COOL;
  case "off":
  default:
    return Characteristic.CurrentHeatingCoolingState.OFF;
  }
};

NestThermostatAccessory.prototype.getTargetHeatingCooling = function () {
  switch (this.device.hvac_mode) {
  case "heat":
    return Characteristic.TargetHeatingCoolingState.HEAT;
  case "cool":
    return Characteristic.TargetHeatingCoolingState.COOL;
  case "heat-cool":
  case "eco":
    if (!this.device.can_cool) {
      return Characteristic.TargetHeatingCoolingState.HEAT;
    } else if (!this.device.can_heat) {
      return Characteristic.TargetHeatingCoolingState.COOL;
    }
    return Characteristic.TargetHeatingCoolingState.AUTO;
  case "off":
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

// Siri will use this even when in AUTO mode
NestThermostatAccessory.prototype.getTargetTemperature = function () {
  switch (this.device.hvac_mode) {
  case "heat-cool":
  case "eco":
    if (!this.device.can_cool) {
      return this.getHeatingThresholdTemperature();
    } else if (!this.device.can_heat) {
      return this.getCoolingThresholdTemperature();
    }

    switch (this.device.hvac_state) {
    case "heating":
      return this.getHeatingThresholdTemperature();
    case "cooling":
      return this.getCoolingThresholdTemperature();
    case "off":
    default:
      return this.getCurrentTemperature();
    }
  default:
    return this.device.target_temperature_c;
  }
};

NestThermostatAccessory.prototype.getCoolingThresholdTemperature = function () {
  switch (this.device.hvac_mode) {
  case "eco":
    return this.device.eco_temperature_high_c ? this.device.eco_temperature_high_c : this.device.away_temperature_high_c;
  case "heat-cool":
  default:
    return this.device.target_temperature_high_c;
  }
};

NestThermostatAccessory.prototype.getHeatingThresholdTemperature = function () {
  switch (this.device.hvac_mode) {
  case "eco":
    return this.device.eco_temperature_low_c ? this.device.eco_temperature_low_c : this.device.away_temperature_low_c;
  case "heat-cool":
  default:
    return this.device.target_temperature_low_c;
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
  let val = null;

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
  let val = "off";

  switch (targetHeatingCooling) {
  case Characteristic.TargetHeatingCoolingState.HEAT:
    val = 'heat';
    break;
  case Characteristic.TargetHeatingCoolingState.COOL:
    val = 'cool';
    break;
  case Characteristic.TargetHeatingCoolingState.AUTO:
    val = 'heat-cool';
    break;
  case Characteristic.TargetHeatingCoolingState.OFF:
  default:
    break;
  }

  return this.updateDevicePropertyAsync("hvac_mode", val, "target heating cooling").asCallback(callback);
};

// Note: HokeKit is not smart enough to avoid sending every temp change while waiting for callback to invoke
NestThermostatAccessory.prototype.setTargetTemperature = function(targetTemperature, callback) {
  this.log('Queuing to set temperature ' + targetTemperature);
  this.setTargetTemperatureDebounced(targetTemperature, function(error) {
    this.log('Temperature set to ' + targetTemperature, error);
  }.bind(this));
  callback();
};

NestThermostatAccessory.prototype.setCoolingThresholdTemperature = function(targetTemperature, callback) {
  this.log('Queuing to set cooling threshold temperature ' + targetTemperature);
  this.setCoolingThresholdTemperatureDebounced(targetTemperature, function(error) {
    this.log('Cooling threshold temperature set to ' + targetTemperature, error);
  }.bind(this));
  callback();
};

NestThermostatAccessory.prototype.setHeatingThresholdTemperature = function(targetTemperature, callback) {
  this.log('Queuing to set heating threshold temperature ' + targetTemperature);
  this.setHeatingThresholdTemperatureDebounced(targetTemperature, function(error) {
    this.log('Heating threshold temperature set to ' + targetTemperature, error);
  }.bind(this));
  callback();
};

// todo: why does this sometimes reset while dragging? (change event coming in while new change queued?)
NestThermostatAccessory.prototype.setTargetTemperatureDebounced = debounce(function (targetTemperature, callback) {
  const ambient = this.device.ambient_temperature_c;
  let setting = "target_temperature_";
  let mode = this.device.hvac_mode;
  let promise = Promise.resolve();

  if (mode === 'eco') {
    mode = this.device.previous_hvac_mode;
    promise = promise.then(() => this.updateDevicePropertyAsync("hvac_mode", mode, "target heating cooling"));
  }

  if (mode === 'off') {
    if (ambient < targetTemperature) {
      promise = promise.then(() => this.updateDevicePropertyAsync("hvac_mode", 'heat', "target heating cooling"));
    } else if (ambient > targetTemperature) {
      promise = promise.then(() => this.updateDevicePropertyAsync("hvac_mode", 'cool', "target heating cooling"));
    } else {
      return void callback();
    }
  } else if (mode === 'heat-cool') {
    if (targetTemperature < this.device.target_temperature_high_c && targetTemperature > this.device.target_temperature_low_c) {
      if (ambient < targetTemperature) {
        setting = 'target_temperature_low_';
      } else if (ambient > targetTemperature) {
        setting = 'target_temperature_high_';
      }
    } else if (targetTemperature > this.device.target_temperature_high_c) {
      setting = 'target_temperature_high_';
    } else if (targetTemperature < this.device.target_temperature_low_c) {
      setting = 'target_temperature_low_';
    } else {
      return void callback();
    }
  }

  return promise.then(() => this.updateTargetWithCorrectUnitsAsync(setting, targetTemperature, "target temperature")).asCallback(callback);
}, 5000);

NestThermostatAccessory.prototype.setHeatCoolIfNeeded = function () {
  return this.device.hvac_mode === 'heat-cool'
    ? Promise.resolve()
    : this.updateDevicePropertyAsync("hvac_mode", 'heat-cool', "target heating cooling");
};

NestThermostatAccessory.prototype.setCoolingThresholdTemperatureDebounced = debounce(function (targetTemperature, callback) {
  return this.setHeatCoolIfNeeded()
    .then(() => this.updateTargetWithCorrectUnitsAsync('target_temperature_high_', targetTemperature, "cooling threshold temperature"))
    .asCallback(callback);
}, 5000);

NestThermostatAccessory.prototype.setHeatingThresholdTemperatureDebounced = debounce(function (targetTemperature, callback) {
  return this.setHeatCoolIfNeeded()
    .then(() => this.updateTargetWithCorrectUnitsAsync('target_temperature_low_', targetTemperature, "heating threshold temperature"))
    .asCallback(callback);
}, 5000);

NestThermostatAccessory.prototype.updateTargetWithCorrectUnitsAsync = function (key, celcius, str) {
  const usesFahrenheit = this.usesFahrenheit();
  key += (usesFahrenheit ? "f" : "c");
  const targetTemperature = usesFahrenheit ? Math.round(celsiusToFahrenheit(celcius)) : celcius;
  return this.updateDevicePropertyAsync(key, targetTemperature, str);
};

NestThermostatAccessory.prototype.getFanState = function () {
  return this.device.fan_timer_active;
};

NestThermostatAccessory.prototype.setFanState = function (targetFanState, callback) {
  this.log("Setting target fan state for " + this.name + " to: " + targetFanState);

  this.updateDevicePropertyAsync("fan_timer_active", Boolean(targetFanState), "fan enable/disable")
    .asCallback(function () {
      setTimeout(callback, 3000, ...arguments); // fan seems to "flicker" when you first enable it
    });
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
  const val = !home ? 'away' : 'home';
  this.log.info("Setting Home for " + this.name + " to: " + val);
  const promise = this.conn.update(this.getStructurePropertyPath("away"), val);
  return promise
    .return(home)
    .asCallback(callback);
};

NestThermostatAccessory.prototype.getEcoMode = function () {
  return (this.device.hvac_mode === "eco");
};

NestThermostatAccessory.prototype.setEcoMode = function (eco, callback) {
  const val = eco ? 'eco' : this.device.previous_hvac_mode;
  this.log.info("Setting Eco Mode for " + this.name + " to: " + val);
  return this.updateDevicePropertyAsync("hvac_mode", val, "target heating cooling")
    .asCallback(callback);
};
