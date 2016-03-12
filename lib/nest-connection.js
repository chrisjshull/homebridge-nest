/**
 * Created by kraigm on 12/15/15.
 */

var Promise = require('bluebird');
var rp = require('request-promise');
var Firebase = require("firebase");

'use strict';

module.exports = Connection;

var logPrefix = "[NestFirebase] ";

function Connection(token, log) {
	this.token = token;
	this.log = function(info) {
		log(logPrefix + info);
	};
	this.debug = this.log;
	this.error = function(info) {
		log.error(logPrefix + info);
	};
}

Connection.prototype.auth = function(clientId, clientSecret, code) {
	return rp({
		method: 'POST',
		uri: 'https://api.home.nest.com/oauth2/access_token',
		form: {
			client_id: clientId,
			client_secret: clientSecret,
			code: code,
			grant_type: "authorization_code"
		}
	})
	.then(function (parsedBody) {
		var body = JSON.parse(parsedBody);
		this.token = body.access_token;
		return this.token;
	}.bind(this));
};

var authAsync = function() {
	return Promise.fromCallback(this.conn.authWithCustomToken.bind(this.conn, this.token));
};

// Create a callback which logs the current auth state
var authDataCallback = function(authData) {
	if (authData) {
		this.debug("User " + authData.uid + " is logged in with " + authData.provider);
	} else {
		this.debug("User is logged out");
		reauthAsync.bind(this)();
	}
};

var reauthAsync = function() {
	// If already reauthorizing, return existing
	if (this.authTask) return this.authTask;

	var self = this;

	// Loop that continues until connection is successful
	var reauthLoopAsync = function(err) {
		if (err) self.error("Reauthorizing error : " + (err.stack || err.message || err));
		self.debug("Delaying next reauthorization attempt (5s)");
		return Promise.delay(5000)
			.then(function() {
				// Attempts to reauthorize Firebase connection
				self.log("Reauthorizing connection");
				return authAsync.call(self);
			})
			.catch(reauthLoopAsync);
	};

	// Create loop and clean up when complete
	return self.authTask || (self.authTask = reauthLoopAsync()
		.finally(function() { self.authTask = null; }));
};

Connection.prototype.open = function() {
	if (!this.token) {
		return Promise.reject(new Error("You must provide a token or auth before you can open a connection."));
	}

	this.conn = new Firebase('wss://developer-api.nest.com', new Firebase.Context());
	return authAsync.call(this)
		.then(function() {
			// Register the callback to be fired every time auth state changes
			this.conn.onAuth(authDataCallback.bind(this));
			return this;
		}.bind(this));
};

Connection.prototype.isOpen = function() {
	return this.conn ? true : false;
};

Connection.prototype.subscribe = function(handler) {
	var self = this;
	return new Promise(function (resolve, reject) {
		if (!handler){
			reject(new Error("You must specify a handler"))
		} else {
			var notify = resolve || handler;
			this.conn.on('value', function (snapshot) {
				var data = snapshot.val();
				if (data) {
					notify(data);
					notify = handler;
				} else {
					self.log("Disconnect Detected");
				}
			});
		}
	}.bind(this));
};

Connection.prototype.update = function(path, data) {
	var child = this.conn.child(path);
	return Promise.fromCallback(child.set.bind(child, data));
};
