var nest = require('unofficial-nest-api');
var NestConnection = require('./lib/nest-connection.js');
var inherits = require('util').inherits;

var Service, Characteristic, Accessory, uuid, Away, ThermostatAccessory;

module.exports = function (homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	Accessory = homebridge.hap.Accessory;
	uuid = homebridge.hap.uuid;

	/**
	 * Characteristic "Away"
	 */
	Away = function () {
		Characteristic.call(this, 'Away', 'D6D47D29-4639-4F44-B53C-D84015DAEBDB');
		this.setProps({
			format: Characteristic.Formats.BOOL,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(Away, Characteristic);

	var exportedTypes = {
		Accessory: Accessory,
		Service: Service,
		Characteristic: Characteristic,
		uuid: uuid,
		Away: Away
	};

	ThermostatAccessory = require('./lib/nest-thermostat-accessory.js')(exportedTypes);

	var acc = NestThermostatAccessory.prototype;
	inherits(NestThermostatAccessory, Accessory);
	NestThermostatAccessory.prototype.parent = Accessory.prototype;
	for (var mn in acc) {
		NestThermostatAccessory.prototype[mn] = acc[mn];
	}

	homebridge.registerPlatform("homebridge-nest", "Nest", NestPlatform);
};

function NestPlatform(log, config) {
	// auth info
	this.username = config["username"];
	this.password = config["password"];
	this.config = config;

	this.log = log;
	this.accessoryLookup = {};
	this.accessoryLookupByStructureId = {};
}

var setupConnection = function(config, log) {
	return new Promise(function (resolve, reject) {
		var token = config["token"];
		var clientId = config["clientId"];
		var clientSecret = config["clientSecret"];
		var code = config["code"];
		var authURL = clientId ? "https://home.nest.com/login/oauth2?client_id=" + clientId + "&state=STATE" : null;

		var err;
		if (!token && !clientId && !clientSecret && !code) {
			err = "You did not specify {'token'} or {'clientId','clientSecret','code'}, one set of which is required for the new API";
		} else if (!token && clientId && clientSecret && !code) {
			err = "You are missing the one-time-use 'code' param. Should be able to obtain from " + authURL;
		} else if (!token && (!clientId || !clientSecret || !code)) {
			err = "If you are going to use {'clientId','clientSecret','code'} then you must specify all three, otherwise use {'token'}";
		}
		if (err) {
			reject(new Error(err));
			return;
		}

		var conn = new NestConnection(token, log);
		if (token) {
			resolve(conn)
		} else {
			conn.auth(clientId, clientSecret, code)
				.then(function(token) {
					if (log) log.warn("CODE IS ONLY VALID ONCE! Update config to use {'token':'" + token + "'} instead.");
					resolve(conn);
				})
				.catch(function(err){
					reject(err);
					if (log) log.warn("Auth failed which likely means the code is no longer valid. Should be able to generate a new one at " + authURL);
				});
		}
	});
};

NestPlatform.prototype = {
	accessories: function (callback) {
		this.log("Fetching Nest devices.");

		var that = this;

		var generateAccessories = function(data) {
			var foundAccessories = [];
			var list = data.device || data.devices.thermostats;
			for (var deviceId in list) {
				if (list.hasOwnProperty(deviceId)) {
					var device = list[deviceId];
					var structureId = device['structure_id'];
					var structure = data.structures[structureId];
					var accessory = new ThermostatAccessory(this.conn, this.log, device, structure);
					that.accessoryLookup[deviceId] = accessory;
					foundAccessories.push(accessory);
				}
			}
			return foundAccessories;
		}.bind(this);

		var updateAccessories = function(data, accList) {
			accList.map(function(acc) {
				var device = data.devices.thermostats[acc.deviceId];
				var structureId = device['structure_id'];
				var structure = data.structures[structureId];
				acc.updateData(device, structure);
			}.bind(this));
		};

		var handleUpdates = function(data){
			updateAccessories(data, that.accessoryLookup);
		};
		setupConnection(this.config, this.log)
			.then(function(conn){
				that.conn = conn;
				return that.conn.open();
			})
			.then(function(){
				return that.conn.subscribe(handleUpdates);
			})
			.then(function(data) {
				that.accessoryLookup = generateAccessories(data);
				if (callback) {
					var copy = that.accessoryLookup.map(function (a) { return a; });
					callback(copy);
				}
			})
			.catch(function(err) {
				that.log.error(err);
				if (that.username && that.password) {
					that.oldaccessories(callback);
				} else if (callback) {
					callback([]);
				}
			});
	},
	oldaccessories: function (callback) {
		this.log.warn("Falling back to legacy API.");

		var that = this;
		var foundAccessories = [];

		nest.login(this.username, this.password, function (err, data) {
			if (err) {
				that.log("There was a problem authenticating with Nest.");
			} else {
				nest.fetchStatus(function (data) {
					for (var deviceId in data.device) {
						if (data.device.hasOwnProperty(deviceId)) {
							var device = data.device[deviceId];
							// it's a thermostat, adjust this to detect other accessories
							if (data.shared[deviceId].hasOwnProperty('current_temperature')) {
								var initialData = data.shared[deviceId];
								var structureId = data.link[deviceId]['structure'].replace('structure.', '');
								var structure = data.structure[structureId];
								var name = initialData.name;
								var accessory = new NestThermostatAccessory(
									that.log, name,
									device, deviceId, initialData,
									structure, structureId);
								that.accessoryLookup[deviceId] = accessory;
								that.accessoryLookupByStructureId[structureId] = accessory;
								foundAccessories.push(accessory);
							}
						}
					}
					function subscribe() {
						nest.subscribe(subscribeDone, ['device', 'shared', 'structure']);
					}

					function subscribeDone(id, data, type) {
						// data if set, is also stored here: nest.lastStatus.shared[thermostatID]
						if (id && type != undefined && data && (that.accessoryLookup[id] || that.accessoryLookupByStructureId[id])) {
							that.log('Update to Device: ' + id + " type: " + type);
							var accessory = that.accessoryLookup[id] || that.accessoryLookupByStructureId[id];
							if (accessory) {
								switch (type) {
									case 'shared':
										accessory.updateData(data);
										break;
									case 'device':
										accessory.device = data;
										accessory.updateData();
										break;
									case 'structure':
										accessory.structure = data;
										accessory.updateData();
										break;
								}
							}

						}
						setTimeout(subscribe, 2000);
					}

					subscribe();
					callback(foundAccessories)
				});
			}
		});
	}
}

function NestThermostatAccessory(log, name, device, deviceId, initialData, structure, structureId) {
	// device info
	this.name = name || ("Nest" + device.serial_number);
	this.deviceId = deviceId;
	this.log = log;
	this.device = device;

	var id = uuid.generate('nest.thermostat.' + deviceId);
	Accessory.call(this, this.name, id);
	this.uuid_base = id;

	this.currentData = initialData;

	this.structureId = structureId;
	this.structure = structure;

	this.getService(Service.AccessoryInformation)
		.setCharacteristic(Characteristic.Manufacturer, "Nest")
		.setCharacteristic(Characteristic.Model, device.model_version)
		.setCharacteristic(Characteristic.SerialNumber, device.serial_number);

	this.addService(Service.Thermostat, name);

	this.getService(Service.Thermostat)
		.addCharacteristic(Away)
		.on('get', function (callback) {
			var away = this.isAway();
			this.log("Away for " + this.name + " is: " + away);
			if (callback) callback(null, away);
		}.bind(this))
		.on('set', this.setAway.bind(this));

	this.getService(Service.Thermostat)
		.getCharacteristic(Characteristic.TemperatureDisplayUnits)
		.on('get', function (callback) {
			var units = this.getTemperatureUnits();
			var unitsName = units == Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? "Fahrenheit" : "Celsius";
			this.log("Temperature unit for " + this.name + " is: " + unitsName);
			if (callback) callback(null, units);
		}.bind(this));

	this.getService(Service.Thermostat)
		.getCharacteristic(Characteristic.CurrentTemperature)
		.on('get', function (callback) {
			var curTemp = this.getCurrentTemperature();
			this.log("Current temperature for " + this.name + " is: " + curTemp);
			if (callback) callback(null, curTemp);
		}.bind(this));

	this.getService(Service.Thermostat)
		.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
		.on('get', function (callback) {
			var curHeatingCooling = this.getCurrentHeatingCooling();
			this.log("Current heating for " + this.name + " is: " + curHeatingCooling);
			if (callback) callback(null, curHeatingCooling);
		}.bind(this));

	this.getService(Service.Thermostat)
		.getCharacteristic(Characteristic.CurrentRelativeHumidity)
		.on('get', function (callback) {
			var curHumidity = this.getCurrentRelativeHumidity();
			this.log("Current humidity for " + this.name + " is: " + curHumidity);
			if (callback) callback(null, curHumidity);
		}.bind(this));

	this.getService(Service.Thermostat)
		.getCharacteristic(Characteristic.TargetTemperature)
		.on('get', function (callback) {
			var targetTemp = this.getTargetTemperature();
			this.log("Target temperature for " + this.name + " is: " + targetTemp);
			if (callback) callback(null, targetTemp);
		}.bind(this))
		.on('set', this.setTargetTemperature.bind(this));

	this.getService(Service.Thermostat)
		.getCharacteristic(Characteristic.TargetHeatingCoolingState)
		.on('get', function (callback) {
			var targetHeatingCooling = this.getTargetHeatingCooling();
			this.log("Target heating for " + this.name + " is: " + targetHeatingCooling);
			if (callback) callback(null, targetHeatingCooling);
		}.bind(this))
		.on('set', this.setTargetHeatingCooling.bind(this));

	this.updateData(initialData);
}

NestThermostatAccessory.prototype.getServices = function () {
	return this.services;
};

NestThermostatAccessory.prototype.updateData = function (data) {
	if (data != undefined) {
		this.currentData = data;
	}
	var thermostat = this.getService(Service.Thermostat);
	thermostat.getCharacteristic(Away).getValue();
	thermostat.getCharacteristic(Characteristic.TemperatureDisplayUnits).getValue();
	thermostat.getCharacteristic(Characteristic.CurrentTemperature).getValue();
	thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).getValue();
	thermostat.getCharacteristic(Characteristic.CurrentRelativeHumidity).getValue();
	thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState).getValue();
	thermostat.getCharacteristic(Characteristic.TargetTemperature).getValue();
};

NestThermostatAccessory.prototype.getCurrentHeatingCooling = function () {
	var current = this.getCurrentTemperature();
	var state = this.getTargetHeatingCooling();

	var isRange = state == (Characteristic.CurrentHeatingCoolingState.HEAT | Characteristic.CurrentHeatingCoolingState.COOL);
	var high = isRange ? this.currentData.target_temperature_high : this.currentData.target_temperature;
	var low = isRange ? this.currentData.target_temperature_low : this.currentData.target_temperature;

	// Add threshold
	var threshold = .2;
	high += threshold;
	low -= threshold;

	if ((state & Characteristic.CurrentHeatingCoolingState.COOL) && this.currentData.can_cool && high < current) {
		return Characteristic.CurrentHeatingCoolingState.COOL;
	}
	if ((state & Characteristic.CurrentHeatingCoolingState.HEAT) && this.currentData.can_heat && low > current) {
		return Characteristic.CurrentHeatingCoolingState.HEAT;
	}
	return Characteristic.CurrentHeatingCoolingState.OFF;
};

NestThermostatAccessory.prototype.getTargetHeatingCooling = function () {
	switch (this.currentData.target_temperature_type) {
		case "off":
			return Characteristic.CurrentHeatingCoolingState.OFF;
		case "heat":
			return Characteristic.CurrentHeatingCoolingState.HEAT;
		case "cool":
			return Characteristic.CurrentHeatingCoolingState.COOL;
		case "range":
			return Characteristic.CurrentHeatingCoolingState.HEAT | Characteristic.CurrentHeatingCoolingState.COOL;
		default:
			return Characteristic.CurrentHeatingCoolingState.OFF;
	}
};

NestThermostatAccessory.prototype.isAway = function () {
	return this.structure.away;
};

NestThermostatAccessory.prototype.getCurrentTemperature = function () {
	return this.currentData.current_temperature;
};

NestThermostatAccessory.prototype.getCurrentRelativeHumidity = function () {
	return this.device.current_humidity;
};

NestThermostatAccessory.prototype.getTargetTemperature = function () {
	switch (this.getTargetHeatingCooling()) {
		case Characteristic.CurrentHeatingCoolingState.HEAT | Characteristic.CurrentHeatingCoolingState.COOL:
			// Choose closest target as single target
			var high = this.currentData.target_temperature_high;
			var low = this.currentData.target_temperature_low;
			var cur = this.currentData.current_temperature;
			return Math.abs(high - cur) < Math.abs(cur - low) ? high : low;
		default:
			return this.currentData.target_temperature;
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

NestThermostatAccessory.prototype.setTargetHeatingCooling = function (targetHeatingCooling, callback) {
	var targetTemperatureType = null;

	switch (targetHeatingCooling) {
		case Characteristic.CurrentHeatingCoolingState.HEAT:
			targetTemperatureType = 'heat';
			break;
		case Characteristic.CurrentHeatingCoolingState.COOL:
			targetTemperatureType = 'cool';
			break;
		case Characteristic.CurrentHeatingCoolingState.HEAT | Characteristic.CurrentHeatingCoolingState.COOL:
			targetTemperatureType = 'range';
			break;
		default:
			targetTemperatureType = 'off';
			break;
	}

	this.log("Setting target heating cooling for " + this.name + " to: " + targetTemperatureType);
	nest.setTargetTemperatureType(this.deviceId, targetTemperatureType);

	if (callback) callback(null, targetTemperatureType);
};

NestThermostatAccessory.prototype.setTargetTemperature = function (targetTemperature, callback) {

	switch (this.getTargetHeatingCooling()) {
		case Characteristic.CurrentHeatingCoolingState.HEAT | Characteristic.CurrentHeatingCoolingState.COOL:
			// Choose closest target as single target
			var high = this.currentData.target_temperature_high;
			var low = this.currentData.target_temperature_low;
			var cur = this.currentData.current_temperature;
			var isHighTemp = Math.abs(high - cur) < Math.abs(cur - low);
			if (isHighTemp) {
				high = targetTemperature;
			} else {
				low = targetTemperature;
			}
			this.log("Setting " + (isHighTemp ? "high" : "low") + " target temperature for " + this.name + " to: " + targetTemperature);
			nest.setTemperatureRange(this.deviceId, low, high);
			break;
		default:
			this.log("Setting target temperature for " + this.name + " to: " + targetTemperature);
			nest.setTemperature(this.deviceId, targetTemperature);
			break;
	}

	if (callback) callback(null, targetTemperature);
};

NestThermostatAccessory.prototype.setAway = function (away, callback) {
	this.log("Setting Away for " + this.name + " to: " + away);
	nest.setAway(Boolean(away), this.structureId);
	if (callback) callback(null, away);
}
