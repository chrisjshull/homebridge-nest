# homebridge-nest
Nest plugin for [HomeBridge](https://github.com/nfarina/homebridge)

This repository contains the Nest plugin for homebridge that was previously bundled in the main `homebridge` repository. 

# Installation


1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-nest
3. Update your configuration file. See sample-config.json snippet below. 

# Configuration

Configuration sample:

 ```
"platforms": [
		{
			"platform": "Nest",
			"name": "Nest",
			"username" : "username",
			"password" : "password"
		}
	],

```

Fields: 

* "platform": Must always be "Nest" (required)
* "name": Can be anything (required)
* "username": Nest login username, same as app (required)
* "password": Nest login password, same as app (required)

