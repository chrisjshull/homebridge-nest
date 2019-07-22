# homebridge-nest
Nest plug-in for [Homebridge](https://github.com/nfarina/homebridge) using the native Nest API.

Integrate your Nest Thermostat (including Nest Temperature Sensors) and Nest Protect devices into your HomeKit system. **homebridge-nest no longer uses the 'Works With Nest' API and will be unaffected by its shutdown in August 2019.**

Currently, homebridge-nest supports Nest Thermostat and Nest Protect devices. Camera and Nest Secure/Detect support may come later. (I don't currently own those devices.)

# Installation

1. Install homebridge using: `npm install -g homebridge`
1. Install this plug-in using: `npm install -g homebridge-nest`
3. Update your configuration file. See `sample-config.json` snippet below.

You will need your Nest account email address and password - the same credentials you use with the Nest app. A 'Works With Nest' developer account and tokens are not required.

# Configuration

Configuration sample (edit `~/.homebridge/config.json`):

```
"platforms": [
		{
			"platform": "Nest",
			"email": "your Nest account email address",
			"password": "your Nest account password"
		}
	],
```

Fields:

* "platform": Must always be "Nest" (required)
* "email": Your Nest account email address (required)
* "password": Your Nest account password (required)
* "pin": "number" // PIN code sent to your mobile device for 2-factor authentication - see below (optional)
* "structureId": "your structure's ID" // optional structureId to filter to (see logs on first run for each device's structureId) - Nest "structures" are equivalent to HomeKit "homes"
* "disable": [] // optional list of features to disable ("Thermostat.Fan", "Thermostat.Home", "Thermostat.Eco", "Thermostat.TemperatureSensors", "Protect.Home")
* "fanDurationMinutes": number of minutes to run the fan when manually turned on (optional, default is 15)

# Two-Factor Authentication

Two-factor authentication is supported if enabled in your Nest account. On starting Homebridge, you will be prompted to enter a PIN code which will be sent to the mobile device number registered to your Nest account.

If you are running Homebridge as a service, you cannot manually enter the PIN in the console. In this case, when you start Homebridge and receive the PIN code, edit config.json and add the PIN received under "pin" (see 'Configuration' above). Then, restart Homebridge. Using 2FA is not recommended if Homebridge is run as a service, because if the connection to the Nest service is interrupted for any reason, homebridge-nest will not be able to automatically reconnect.

# HomeKit Accessory Types

## Nest Thermostat

* *Thermostat* accessory with ambient temperature and humidity sensors, mode control (heat/cool/auto/off), and target temperature control
* *Switch* accessory (Home Occupied) indicating detected Home/Away state - can be manually changed. Disable by adding "Thermostat.Home" to "disable" field in config.json
* *Switch* accessory (Eco Mode) indicating current eco mode state - can be manually changed. Disable by adding "Thermostat.Eco" to "disable" field in config.json
* *Fan* accessory indicating whether the fan is running - can be manually changed. Disable by adding "Thermostat.Fan" to "disable" field in config.json
* *TemperatureSensor* accessory indicating the ambient temperature where each additional Nest Temperature Sensor is located. Disable by adding "Thermostat.TemperatureSensors" to "disable" field in config.json

## Nest Protect

* *SmokeSensor* accessory (Smoke) indicating smoke detected
* *CarbonMonoxideSensor* accessory (Carbon Monoxide) indicating CO detected
* *OccupancySensor* accessory (Home Occupied) indicating detected occupancy (Home/Away) state. Disable by adding "Protect.Home" to "disable" field in config.json - you will want to do this if your home has both a Thermostat and Protects to avoid a duplicate home/away accessory

# Donate to Support homebridge-nest

homebridge-nest is a labour of love. It's provided under the ISC licence and is completely free to do whatever you want with. But if you'd like to show your appreciation for its continued development, please consider [clicking here to make a small donation](https://paypal.me/adriancable586) or send me a thank-you card:

Adrian Cable  
PO Box 370365  
Montara, CA 94037  

I appreciate your feedback and support in whatever form!