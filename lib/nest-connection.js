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


// Create a callback which logs the current auth state
function authDataCallback(authData) {
	if (authData) {
		this.debug("User " + authData.uid + " is logged in with " + authData.provider);
	} else {
		this.debug("User is logged out");
	}
}

Connection.prototype.open = function() {
	return new Promise(function (resolve, reject) {
		if (!this.token) {
			reject(new Error("You must provide a token or auth before you can open a connection."));
		} else {
			this.conn = new Firebase('wss://developer-api.nest.com', new Firebase.Context());

			// Register the callback to be fired every time auth state changes
			this.conn.onAuth(authDataCallback.bind(this));

			this.conn.authWithCustomToken(this.token, function (err) {
				if (err) reject(err);
				else resolve(this);
			}.bind(this));
		}
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
	return new Promise(function (resolve, reject) {
		var child = this.conn.child(path);
		//var val = child.get();
		child.set(data, function(err){
			if (err) reject(err);
			else resolve();
		});
	}.bind(this));
};
