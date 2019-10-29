/**
 * Created by kraigm on 12/15/15.
 */

const Promise = require('bluebird');
const inherits = require('util').inherits;
let Accessory, Service, Characteristic;
let FanTimerActive, FanTimerDuration, HasLeaf, SunlightCorrectionEnabled, SunlightCorrectionActive, UsingEmergencyHeat;
const NestDeviceAccessory = require('./nest-device-accessory')();

'use strict';

module.exports = function(exportedTypes) {
    if (exportedTypes && !Accessory) {
        Accessory = exportedTypes.Accessory;
        Service = exportedTypes.Service;
        Characteristic = exportedTypes.Characteristic;
        // uuid = exportedTypes.uuid;

        // Define custom characteristics

        /*
       * Characteristic "FanTimerActive"
       */
        FanTimerActive = function () {
            Characteristic.call(this, 'Fan Timer Active', 'D6D47D29-4640-4F44-B53C-D84015DAEBDB');
            this.setProps({
                format: Characteristic.Formats.BOOL,
                perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        };
        inherits(FanTimerActive, Characteristic);

        /*
       * Characteristic "FanTimerDuration"
       */
        FanTimerDuration = function () {
            Characteristic.call(this, 'Fan Timer Duration', 'D6D47D29-4641-4F44-B53C-D84015DAEBDB');
            this.setProps({
                format: Characteristic.Formats.UINT8,
                unit: Characteristic.Units.MINUTES,
                maxValue: 60,
                minValue: 15,
                minStep: 15,
                perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        };
        inherits(FanTimerDuration, Characteristic);

        /*
       * Characteristic "HasLeaf"
       */
        HasLeaf = function () {
            Characteristic.call(this, 'Has Leaf', 'D6D47D29-4642-4F44-B53C-D84015DAEBDB');
            this.setProps({
                format: Characteristic.Formats.BOOL,
                perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        };
        inherits(HasLeaf, Characteristic);

        /*
       * Characteristic "SunlightCorrectionEnabled"
       */
        SunlightCorrectionEnabled = function () {
            Characteristic.call(this, 'Sunlight Correction Enabled', 'D6D47D29-4644-4F44-B53C-D84015DAEBDB');
            this.setProps({
                format: Characteristic.Formats.BOOL,
                perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        };
        inherits(SunlightCorrectionEnabled, Characteristic);

        /*
       * Characteristic "SunlightCorrectionActive"
       */
        SunlightCorrectionActive = function () {
            Characteristic.call(this, 'Sunlight Correction Active', 'D6D47D29-4645-4F44-B53C-D84015DAEBDB');
            this.setProps({
                format: Characteristic.Formats.BOOL,
                perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        };
        inherits(SunlightCorrectionActive, Characteristic);

        /*
       * Characteristic "UsingEmergencyHeat"
       */
        UsingEmergencyHeat = function () {
            Characteristic.call(this, 'Using Emergency Heat', 'D6D47D29-4646-4F44-B53C-D84015DAEBDB');
            this.setProps({
                format: Characteristic.Formats.BOOL,
                perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        };
        inherits(UsingEmergencyHeat, Characteristic);

        const acc = NestThermostatAccessory.prototype;
        inherits(NestThermostatAccessory, NestDeviceAccessory);
        NestThermostatAccessory.prototype.parent = NestDeviceAccessory.prototype;
        for (const mn in acc) {
            NestThermostatAccessory.prototype[mn] = acc[mn];
        }

        NestThermostatAccessory.deviceType = 'thermostat';
        NestThermostatAccessory.deviceGroup = 'thermostats';
        NestThermostatAccessory.deviceDesc = 'Nest Thermostat';
        NestThermostatAccessory.prototype.deviceType = NestThermostatAccessory.deviceType;
        NestThermostatAccessory.prototype.deviceGroup = NestThermostatAccessory.deviceGroup;
        NestThermostatAccessory.prototype.deviceDesc = NestThermostatAccessory.deviceDesc;
    }
    return NestThermostatAccessory;
};

function NestThermostatAccessory(conn, log, device, structure, platform) {
    NestDeviceAccessory.call(this, conn, log, device, structure, platform);

    const thermostatService = this.addService(Service.Thermostat);

    const formatCurrentHeatingCoolingState = function (val) {
        switch (val) {
        case Characteristic.CurrentHeatingCoolingState.OFF:
            return 'Off';
        case Characteristic.CurrentHeatingCoolingState.HEAT:
            return 'Heating';
        case Characteristic.CurrentHeatingCoolingState.COOL:
            return 'Cooling';
        }
    };

    const formatTargetHeatingCoolingState = function (val) {
        switch (val) {
        case Characteristic.TargetHeatingCoolingState.OFF:
            return 'Off';
        case Characteristic.TargetHeatingCoolingState.HEAT:
            return 'Heat';
        case Characteristic.TargetHeatingCoolingState.COOL:
            return 'Cool';
        case Characteristic.TargetHeatingCoolingState.AUTO:
            return 'Auto';
        }
    };

    const bindCharacteristic = function (characteristic, desc, getFunc, setFunc, format) {
        this.bindCharacteristic(thermostatService, characteristic, desc, getFunc, setFunc, format);
    }.bind(this);

    bindCharacteristic(Characteristic.TemperatureDisplayUnits, 'Temperature unit', this.getTemperatureUnits, this.setTemperatureUnits, function (val) {
        return val == Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? 'Fahrenheit' : 'Celsius';
    });

    bindCharacteristic(Characteristic.CurrentTemperature, 'Current temperature', this.getCurrentTemperature, null, this.formatAsDisplayTemperature);
    bindCharacteristic(Characteristic.CurrentHeatingCoolingState, 'Current heating/cooling state', this.getCurrentHeatingCooling, null, formatCurrentHeatingCoolingState);
    bindCharacteristic(Characteristic.CurrentRelativeHumidity, 'Current humidity', this.getCurrentRelativeHumidity, null, function(val) {
        return val + '%';
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

    thermostatService.getCharacteristic(Characteristic.TargetTemperature).setProps({ minValue: fahrenheitToCelsius(50), maxValue: fahrenheitToCelsius(90) });
    thermostatService.getCharacteristic(Characteristic.CoolingThresholdTemperature).setProps({ minValue: fahrenheitToCelsius(50), maxValue: fahrenheitToCelsius(90) });
    thermostatService.getCharacteristic(Characteristic.HeatingThresholdTemperature).setProps({ minValue: fahrenheitToCelsius(50), maxValue: fahrenheitToCelsius(90) });

    if (!this.device.can_cool) {
        thermostatService.getCharacteristic(Characteristic.TargetHeatingCoolingState).setProps({validValues: [Characteristic.TargetHeatingCoolingState.OFF, Characteristic.TargetHeatingCoolingState.HEAT]});
    } else if (!this.device.can_heat) {
        thermostatService.getCharacteristic(Characteristic.TargetHeatingCoolingState).setProps({validValues: [Characteristic.TargetHeatingCoolingState.OFF, Characteristic.TargetHeatingCoolingState.COOL]});
    }

    bindCharacteristic(Characteristic.TargetTemperature, 'Target temperature', this.getTargetTemperature, this.setTargetTemperature, this.formatAsDisplayTemperature);
    bindCharacteristic(Characteristic.TargetHeatingCoolingState, 'Target heating/cooling state', this.getTargetHeatingCooling, this.setTargetHeatingCooling, formatTargetHeatingCoolingState);

    bindCharacteristic(Characteristic.CoolingThresholdTemperature, 'Cooling threshold temperature', this.getCoolingThresholdTemperature, this.setCoolingThresholdTemperature, this.formatAsDisplayTemperature);
    bindCharacteristic(Characteristic.HeatingThresholdTemperature, 'Heating threshold temperature', this.getHeatingThresholdTemperature, this.setHeatingThresholdTemperature, this.formatAsDisplayTemperature);

    if (this.device.has_fan && !this.platform.optionSet('Thermostat.Fan.Disable', this.device.serial_number, this.device.device_id)) {
        const thermostatFanService = this.addService(Service.Fan, this.device.where_name + ' Thermostat Fan', 'fan.' + this.device.serial_number);
        const formatFanState = function (val) {
            if (val) {
                return 'On';
            }
            return 'Off';
        };
        this.bindCharacteristic(thermostatFanService, Characteristic.On, 'Fan State', this.getFanState, this.setFanState, formatFanState);
    }

    thermostatService.addOptionalCharacteristic(Characteristic.StatusActive);
    bindCharacteristic(Characteristic.StatusActive, 'Online status', this.getOnlineStatus);

    if (!this.platform.optionSet('Thermostat.Eco.Disable', this.device.serial_number, this.device.device_id)) {
        const thermostatEcoModeService = this.addService(Service.Switch, this.device.where_name + ' Thermostat Eco Mode', 'eco_mode.' + this.device.serial_number);
        this.bindCharacteristic(thermostatEcoModeService, Characteristic.On, 'Eco Mode', this.getEcoMode, this.setEcoMode);
    }

    if (this.platform.optionSet('Thermostat.SeparateBuiltInTemperatureSensor.Enable', this.device.serial_number, this.device.device_id)) {
        const tempService = this.addService(Service.TemperatureSensor, this.device.where_name, 'temp-sensor.' + this.device.serial_number);
        this.bindCharacteristic(tempService, Characteristic.CurrentTemperature, 'Temperature', this.getBackplateTemperature);
    }

    if (this.platform.optionSet('Thermostat.SeparateBuiltInHumiditySensor.Enable', this.device.serial_number, this.device.device_id)) {
        const humService = this.addService(Service.HumiditySensor, this.device.where_name, 'humidity-sensor.' + this.device.serial_number);
        this.bindCharacteristic(humService, Characteristic.CurrentRelativeHumidity, 'Humidity', this.getCurrentRelativeHumidity);
    }

    // Add custom characteristics

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
    return this.getTemperatureUnits() === Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
};

NestThermostatAccessory.prototype.unroundTemperature = function (key) {
    // Fudge the temperature to correct rounding discrepancy between Nest read-out and HomeKit read-out
    if (!this.usesFahrenheit()) {
        return this.device[key];
    } else {
        let tempInF = Math.round(celsiusToFahrenheit(this.device[key]));
        return fahrenheitToCelsius(tempInF);
    }
};

NestThermostatAccessory.prototype.getCurrentHeatingCooling = function () {
    switch (this.device.hvac_state) {
    case 'heating':
        return Characteristic.CurrentHeatingCoolingState.HEAT;
    case 'cooling':
        return Characteristic.CurrentHeatingCoolingState.COOL;
    case 'off':
    default:
        return Characteristic.CurrentHeatingCoolingState.OFF;
    }
};

NestThermostatAccessory.prototype.getTargetHeatingCooling = function () {
    switch (this.device.hvac_mode) {
    case 'heat':
        return Characteristic.TargetHeatingCoolingState.HEAT;
    case 'cool':
        return Characteristic.TargetHeatingCoolingState.COOL;
    case 'range':
        return Characteristic.TargetHeatingCoolingState.AUTO;
    case 'eco':
        if (this.device.away_temperature_high_enabled && this.device.away_temperature_low_enabled) {
            return Characteristic.TargetHeatingCoolingState.AUTO;
        } else if (this.device.away_temperature_low_enabled) {
            return Characteristic.TargetHeatingCoolingState.HEAT;
        } else if (this.device.away_temperature_high_enabled) {
            return Characteristic.TargetHeatingCoolingState.COOL;
        } else {
            return Characteristic.TargetHeatingCoolingState.OFF;
        }
    case 'off':
    default:
        return Characteristic.TargetHeatingCoolingState.OFF;
    }
};

NestThermostatAccessory.prototype.getCurrentTemperature = function () {
    return this.unroundTemperature('current_temperature');
};

NestThermostatAccessory.prototype.getBackplateTemperature = function () {
    return this.unroundTemperature('backplate_temperature') || this.unroundTemperature('current_temperature');
};

NestThermostatAccessory.prototype.getCurrentRelativeHumidity = function () {
    return this.device.current_humidity;
};

// Siri will use this even when in AUTO mode
NestThermostatAccessory.prototype.getTargetTemperature = function () {
    this.verbose('getTargetTemperature', this.device.hvac_mode, this.device.hvac_state, this.device.target_temperature);
    switch (this.device.hvac_mode) {
    case 'eco':
        if (this.device.away_temperature_low_enabled && !this.device.away_temperature_high_enabled) {
            return this.getHeatingThresholdTemperature();
        } else if (this.device.away_temperature_high_enabled && !this.device.away_temperature_low_enabled) {
            return this.getCoolingThresholdTemperature();
        } else {
            return this.getCurrentTemperature();
        }
    case 'off':
        return this.getCurrentTemperature();
    default:
        return this.unroundTemperature('target_temperature');
    }
};

NestThermostatAccessory.prototype.getCoolingThresholdTemperature = function () {
    switch (this.device.hvac_mode) {
    case 'eco':
    // away_temperature deprecated in v5. in v6 use eco_temperature but if undefined, fallback to away_temperature
        return this.unroundTemperature('eco_temperature_high') || this.unroundTemperature('away_temperature_high');
    default:
        return this.unroundTemperature('target_temperature_high') || this.unroundTemperature('target_temperature');
    }
};

NestThermostatAccessory.prototype.getHeatingThresholdTemperature = function () {
    switch (this.device.hvac_mode) {
    case 'eco':
    // away_temperature deprecated in v5. in v6 use eco_temperature but if undefined, fallback to away_temperature
        return this.unroundTemperature('eco_temperature_low') || this.unroundTemperature('away_temperature_low');
    default:
        return this.unroundTemperature('target_temperature_low') || this.unroundTemperature('target_temperature');
    }
};

NestThermostatAccessory.prototype.getTemperatureUnits = function () {
    switch (this.device.temperature_scale) {
    case 'F':
        return Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
    case 'C':
    default:
        return Characteristic.TemperatureDisplayUnits.CELSIUS;
    }
};

NestThermostatAccessory.prototype.setTemperatureUnits = function (temperatureUnits, callback) {
    let val = null;

    switch (temperatureUnits) {
    case Characteristic.TemperatureDisplayUnits.FAHRENHEIT:
        val = 'F';
        break;
    case Characteristic.TemperatureDisplayUnits.CELSIUS:
    default:
        val = 'C';
        break;
    }

    return this.setPropertyAsync('device', 'temperature_scale', val, 'temperature display units')
        .asCallback(callback);
};

NestThermostatAccessory.prototype.setTargetHeatingCooling = function (targetHeatingCooling, callback) {
    let val = 'off';

    switch (targetHeatingCooling) {
    case Characteristic.TargetHeatingCoolingState.HEAT:
        val = 'heat';
        break;
    case Characteristic.TargetHeatingCoolingState.COOL:
        val = 'cool';
        break;
    case Characteristic.TargetHeatingCoolingState.AUTO:
        val = (this.device.can_heat && this.device.can_cool) ? 'range' : this.device.can_cool ? 'cool' : 'heat';
        break;
    case Characteristic.TargetHeatingCoolingState.OFF:
    default:
        break;
    }

    if (this.getTargetHeatingCooling() == targetHeatingCooling) {
        // Workaround for iOS 13 issue with Eco Mode spontaneously switching back to Heat-Cool
        return void callback();
    }

    this.verbose('setTargetHeatingCooling', val);
    return this.setPropertyAsync('shared', 'hvac_mode', val, 'target heating cooling').asCallback(callback);
};

NestThermostatAccessory.prototype.setTargetTemperature = function(targetTemperature, callback) {
    this.verbose('setTargetTemperature', this.device.hvac_mode, targetTemperature);

    let deviceType = 'shared';
    let setting = 'target_temperature';
    let mode = this.device.hvac_mode;
    let promise = Promise.resolve();

    if (mode === 'eco') {
        deviceType = 'device';
        if (this.device.away_temperature_low_enabled && !this.device.away_temperature_high_enabled) {
            setting = 'away_temperature_low';
        } else if (this.device.away_temperature_high_enabled && !this.device.away_temperature_low_enabled) {
            setting = 'away_temperature_high';
        } else {
            return void callback();
        }
    } else if (mode === 'range') {
        return void callback();
    }

    this.log('Setting temperature to ' + this.formatAsDisplayTemperature(targetTemperature));
    return promise.then(() => this.setPropertyAsync(deviceType, setting, targetTemperature, 'target temperature')).asCallback(callback);
};

NestThermostatAccessory.prototype.setCoolingThresholdTemperature = function(targetTemperature, callback) {
    this.verbose('setCoolingThresholdTemperature', targetTemperature);

    let mode = this.device.hvac_mode;
    let deviceType = 'shared';
    let setting = 'target_temperature_high';
    if (mode === 'eco') {
        if (this.device.can_heat && this.device.can_cool) {
            deviceType = 'device';
            setting = 'away_temperature_high';
        } else {
            return void callback();
        }
    }

    this.log('Setting cooling threshold temperature to ' + this.formatAsDisplayTemperature(targetTemperature));
    return this.setPropertyAsync(deviceType, setting, targetTemperature, 'cooling threshold temperature').asCallback(callback);
};

NestThermostatAccessory.prototype.setHeatingThresholdTemperature = function(targetTemperature, callback) {
    this.verbose('setHeatingThresholdTemperature', targetTemperature);

    let mode = this.device.hvac_mode;
    let deviceType = 'shared';
    let setting = 'target_temperature_low';
    if (mode === 'eco') {
        if (this.device.can_heat && this.device.can_cool) {
            deviceType = 'device';
            setting = 'away_temperature_low';
        } else {
            return void callback();
        }
    }

    this.log('Setting heating threshold temperature to ' + this.formatAsDisplayTemperature(targetTemperature));
    return this.setPropertyAsync(deviceType, setting, targetTemperature, 'heating threshold temperature').asCallback(callback);
};

NestThermostatAccessory.prototype.getFanState = function () {
    return this.device.fan_timer_active;
};

NestThermostatAccessory.prototype.setFanState = function (targetFanState, callback) {
    this.log('Setting target fan state for ' + this.name + ' to: ' + targetFanState);
    return this.setPropertyAsync('device', 'fan_timer_active', Boolean(targetFanState), 'fan enable/disable').asCallback(callback);
};

NestThermostatAccessory.prototype.getEcoMode = function () {
    return (this.device.hvac_mode === 'eco');
};

NestThermostatAccessory.prototype.setEcoMode = function (eco, callback) {
    const val = eco ? 'eco' : this.device.previous_hvac_mode;
    this.log.info('Setting Eco Mode for ' + this.name + ' to: ' + val);
    this.device.hvac_mode = val;
    return this.setPropertyAsync('shared', 'hvac_mode', eco ? 'eco' : 'eco-off', 'target heating cooling', null, true).asCallback(callback);
};

NestThermostatAccessory.prototype.formatAsDisplayTemperature = function(t) {
    return t + ' °C / ' + Math.round(celsiusToFahrenheit(t)) + ' °F';
};

NestThermostatAccessory.prototype.addFanTimerActiveCharacteristic = function(service) {
    service.addCharacteristic(FanTimerActive);
    this.bindCharacteristic(service, FanTimerActive, 'Fan Timer Active', this.isFanTimerActive, this.setFanTimerActive);
};

NestThermostatAccessory.prototype.addFanTimerDurationCharacteristic = function(service) {
    service.addCharacteristic(FanTimerDuration);
    this.bindCharacteristic(service, FanTimerDuration, 'Fan Timer Duration', this.isFanTimerDuration, this.setFanTimerDuration);
};

NestThermostatAccessory.prototype.addHasLeafCharacteristic = function(service) {
    service.addCharacteristic(HasLeaf);
    this.bindCharacteristic(service, HasLeaf, 'Has Leaf', this.isHasLeaf);
};

NestThermostatAccessory.prototype.addSunlightCorrectionEnabledCharacteristic = function(service) {
    service.addCharacteristic(SunlightCorrectionEnabled);
    this.bindCharacteristic(service, SunlightCorrectionEnabled, 'Sunlight Correction Enabled', this.isSunlightCorrectionEnabled);
};

NestThermostatAccessory.prototype.addSunlightCorrectionActiveCharacteristic = function(service) {
    service.addCharacteristic(SunlightCorrectionActive);
    this.bindCharacteristic(service, SunlightCorrectionActive, 'Sunlight Correction Active', this.isSunlightCorrectionActive);
};

NestThermostatAccessory.prototype.addUsingEmergencyHeatCharacteristic = function(service) {
    service.addCharacteristic(UsingEmergencyHeat);
    this.bindCharacteristic(service, UsingEmergencyHeat, 'Using Emergency Heat', this.isUsingEmergencyHeat);
};

NestThermostatAccessory.prototype.isFanTimerActive = function () {
    return this.device.fan_timer_active;
};

NestThermostatAccessory.prototype.isFanTimerDuration = function () {
    return this.device.fan_timer_duration;
};

NestThermostatAccessory.prototype.isHasLeaf = function () {
    return this.device.has_leaf;
};

NestThermostatAccessory.prototype.isSunlightCorrectionEnabled = function () {
    return this.device.sunlight_correction_enabled;
};

NestThermostatAccessory.prototype.isSunlightCorrectionActive = function () {
    return this.device.sunlight_correction_active;
};

NestThermostatAccessory.prototype.isUsingEmergencyHeat = function () {
    return this.device.is_using_emergency_heat;
};

NestThermostatAccessory.prototype.getOnlineStatus = function () {
    return this.device.is_online;
};

NestThermostatAccessory.prototype.verbose = function (...info) {
    if (this.platform.optionSet('Debug.Verbose')) {
        this.log.debug(...info);
    }
};
