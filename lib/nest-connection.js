/**
 * Created by kraigm on 12/15/15.
 */

var Promise = require('promise');
var rp = require('request-promise');
var Firebase = require("firebase");

'use strict';

module.exports = Connection;

function Connection(token) {
	this.token = token;
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
		this.token = parsedBody.access_token;
	}.bind(this));
};

Connection.prototype.open = function() {
	return new Promise(function (resolve, reject) {
		if (!this.token) {
			reject(new Error("You must provide a token or auth before you can open a connection."));
		} else {
			this.conn = new Firebase('wss://developer-api.nest.com', new Firebase.Context());
			this.conn.authWithCustomToken(this.token, function (err) {
				if (err) reject(err);
				else resolve();
			});
		}
	}.bind(this));
};

Connection.prototype.isOpen = function() {
	return this.conn ? true : false;
};

Connection.prototype.subscribe = function(handler) {
	return new Promise(function (resolve, reject) {
		if (!handler){
			reject(new Error("You must specify a handler"))
		} else {
			var notify = resolve || handler;
			this.conn.on('value', function (snapshot) {
				var data = snapshot.val();
				notify(data);
				notify = handler;
			});
		}
	}.bind(this));
};
