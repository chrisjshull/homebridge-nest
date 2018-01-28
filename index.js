var NestConnection = require('./lib/nest-connection.js');
var inherits = require('util').inherits;
var Promise = require('bluebird');

var Service, Characteristic, Accessory, uuid;
var DeviceAccessory, ThermostatAccessory, StructureAccessory, ProtectAccessory, CamAccessory;
var Away, EcoMode, FanTimerActive, FanTimerDuration, HasLeaf, ManualTestActive, SunlightCorrectionEnabled, SunlightCorrectionActive, UsingEmergencyHeat;

module.exports = function (homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	Accessory = homebridge.hap.Accessory;
	uuid = homebridge.hap.uuid;

// Define custom characteristics

	/**
	 * Characteristic "Away"
	 */
	Away = function () {
		Characteristic.call(this, 'Away', 'D6D47D29-4638-4F44-B53C-D84015DAEBDB');
		this.setProps({
			format: Characteristic.Formats.BOOL,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(Away, Characteristic);

	/**
	 * Characteristic "EcoMode"
	 */
	EcoMode = function () {
		Characteristic.call(this, 'Eco Mode', 'D6D47D29-4639-4F44-B53C-D84015DAEBDB');
		this.setProps({
			format: Characteristic.Formats.BOOL,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(EcoMode, Characteristic);

	/**
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

	/**
	 * Characteristic "FanTimerDuration"
	 */
	FanTimerDuration = function () {
		Characteristic.call(this, 'Fan Timer Duraton', 'D6D47D29-4641-4F44-B53C-D84015DAEBDB');
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

	/**
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

	/**
	 * Characteristic "ManualTestActive"
	 */
	ManualTestActive = function () {
		Characteristic.call(this, 'Manual Test Active', 'D6D47D29-4643-4F44-B53C-D84015DAEBDB');
		this.setProps({
			format: Characteristic.Formats.BOOL,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(ManualTestActive, Characteristic);

	/**
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

	/**
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

	/**
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

	var exportedTypes = {
		Accessory: Accessory,
		Service: Service,
		Characteristic: Characteristic,
		uuid: uuid,
		Away: Away,
		EcoMode: EcoMode,
		FanTimerActive: FanTimerActive,
		FanTimerDuration: FanTimerDuration,
		HasLeaf: HasLeaf,
		ManualTestActive: ManualTestActive,
		SunlightCorrectionEnabled: SunlightCorrectionEnabled,
		SunlightCorrectionActive: SunlightCorrectionActive,
		UsingEmergencyHeat: UsingEmergencyHeat
	};

	DeviceAccessory = require('./lib/nest-device-accessory.js')(exportedTypes);
	StructureAccessory = require('./lib/nest-structure-accessory.js')(exportedTypes);
	ThermostatAccessory = require('./lib/nest-thermostat-accessory.js')(exportedTypes);
	ProtectAccessory = require('./lib/nest-protect-accessory.js')(exportedTypes);
	CamAccessory = require('./lib/nest-cam-accessory.js')(exportedTypes);

	homebridge.registerPlatform("homebridge-nest", "Nest", NestPlatform);
};

function NestPlatform(log, config) {
	// auth info
	this.config = config;

	this.log = log;
	this.accessoryLookup = {};
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
			resolve(conn);
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

			var loadDevices = function(DeviceType) {
				var list = data.devices && data.devices[DeviceType.deviceGroup];
				for (var deviceId in list) {
					if (list.hasOwnProperty(deviceId)) {
						var device = list[deviceId];
						var structureId = device['structure_id'];
						var structure = data.structures[structureId];
						var accessory = new DeviceType(this.conn, this.log, device, structure);
						that.accessoryLookup[deviceId] = accessory;
						foundAccessories.push(accessory);
					}
				}
			}.bind(this);

			loadDevices(StructureAccessory);
			loadDevices(ThermostatAccessory);
			loadDevices(ProtectAccessory);
			loadDevices(CamAccessory);

			return foundAccessories;
		}.bind(this);

		var updateAccessories = function(data, accList) {
			accList.map(function(acc) {
				var device = data.devices[acc.deviceGroup][acc.deviceId];
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
				if (callback) {
					callback([]);
				}
			});
	}
};
