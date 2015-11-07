# homebridge-nest
Nest plugin for HomeBridge

This repository contains the Nest plugin for homebridge that was previously bundled in the main `homebridge` repository. 

# Installation

This plugin should be installed "globally" using -g.

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-netatmo
3. Update your configuration file. See sample-config.json snippet below. 

    npm install -g homebridge-nest

# Configuration

Configuration sample:

 ```
"platforms": [
        {
            "platform": "Nest",
            "name": "Nest",
            "username" : "username",
            "password" : "password"
        },
        {
            "platform": "EzControlXS1",
            "name": "EzControl XS1",
            "xs1address" : "xs1"
        }
    ],

```
