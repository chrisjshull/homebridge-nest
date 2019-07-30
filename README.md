# homebridge-nest
Nest plug-in for [Homebridge](https://github.com/nfarina/homebridge) using the native Nest API. See what's new in [release 3.2.2](https://github.com/chrisjshull/homebridge-nest/releases/tag/v3.2.2).

Integrate your Nest Thermostat (including Nest Temperature Sensors) and Nest Protect devices into your HomeKit system. **homebridge-nest no longer uses the 'Works With Nest' API and will be unaffected by its shutdown in August 2019.**

Currently, homebridge-nest supports Nest Thermostat and Nest Protect devices. Camera and Nest Secure/Detect support may come later. (I don't currently own those devices.)

# Installation

<!-- 2. Clone (or pull) this repository from github into the same path Homebridge lives (usually `/usr/local/lib/node_modules`). Note: the code currently on GitHub is in beta, and is newer than the latest published version of this package on `npm` -->
1. Install homebridge using: `npm install -g homebridge`
2. Install this plug-in using: `npm install -g homebridge-nest`
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

* `"platform"`: Must always be `"Nest"` (required)
* `"email"`: Your Nest account email address (required)
* `"password"`: Your Nest account password (required)
* `"pin"`: `"number"` // PIN code sent to your mobile device for 2-factor authentication - see below (optional)
* `"structureId"`: `"your structure's ID"` // optional structureId to filter to (see logs on first run for each device's structureId) - Nest "structures" are equivalent to HomeKit "homes"
* `"options"`: `[ "feature1", "feature2", ... ]` // optional list of features to enable/disable (see below)
* `"fanDurationMinutes"`: number of minutes to run the fan when manually turned on (optional, default is 15)

Note: the syntax for setting features to enable/disable has changed since 3.0.0. The `"disabled"` configuration option is no longer supported in 3.1.0 - please use `"options"` instead.

# Two-Factor Authentication

Two-factor authentication is supported if enabled in your Nest account. On starting Homebridge, you will be prompted to enter a PIN code which will be sent to the mobile device number registered to your Nest account.

If you are running Homebridge as a service, you cannot manually enter the PIN in the console. In this case, when you start Homebridge and receive the PIN code, edit config.json and add the PIN received under "pin" (see 'Configuration' above). Then, restart Homebridge. Using 2FA is not recommended if Homebridge is run as a service, because if the connection to the Nest service is interrupted for any reason, homebridge-nest will not be able to automatically reconnect.

# HomeKit Accessory Types

## Home

* *Switch* accessory (Home Occupied) indicating detected Home/Away state - can be manually changed

## Nest Thermostat

* *Thermostat* accessory with ambient temperature and humidity sensors, mode control (heat/cool/auto/off), and target temperature control
* *Switch* accessory (Eco Mode) for turning on and off Eco Mode
* *Fan* accessory for controlling the fan
* *TemperatureSensor* accessory indicating the ambient temperature at the thermostat (disabled by default - temperature is reported by the base *Thermostat* accessory)
* *TemperatureSensor* accessory indicating the ambient temperature where each additional Nest Temperature Sensor is located
* *HumiditySensor* accessory indicating the relative humidity at the thermostat (disabled by default - humidity is reported by the base *Thermostat* accessory)

## Nest Protect

* *SmokeSensor* accessory (Smoke) indicating smoke detected
* *CarbonMonoxideSensor* accessory (Carbon Monoxide) indicating CO detected

# Feature Options

Set `"options"` in `config.json` to an array of strings chosen from the following to customise feature options:

* `"Thermostat.Disable"` - exclude Nest Thermostats from HomeKit
* `"Thermostat.Fan.Disable"` - do not create a *Fan* accessory for the thermostat
* `"Thermostat.Eco.Disable"` - do not create a *Switch* accessory to indicate/control Eco Mode status
* `"Thermostat.SeparateBuiltInTemperatureSensor.Enable"` - create an additional *TemperatureSensor* accessory to report the ambient temperature at the thermostat
* `"Thermostat.SeparateBuiltInHumiditySensor.Enable"` - create an additional *HumiditySensor* accessory to report the relative humidity at the thermostat
* `"TempSensor.Disable"` - exclude Nest Temperature Sensors from HomeKit
* `"HomeAway.Disable"` - exclude Home/Away switch from HomeKit
* `"HomeAway.AsOccupancySensor"` - create Home/Away indicator as an *OccupancySensor* instead of a *Switch* - useful for automations
* `"HomeAway.AsOccupancySensorAndSwitch"` - create Home/Away indicator as an *OccupancySensor* and a *Switch*
* `"Protect.Disable"` - exclude Nest Protects from HomeKit

By default, options set apply to all devices. To set an option for a specific device only, add `.device_id` to the corresponding `option`, where `device_id` is shown in the Homebridge logs, or in HomeKit itself as *Serial Number* in the Settings page for your device. For example, to disable one specific thermostat with serial number 09AC01AC31180349, add `Thermostat.Disable.09AC01AC31180349` to `"options"`.

# Things to try with Siri

* Hey Siri, *set the temperature to 72 degrees*. (in heat-only or cool-only mode)
* Hey Siri, *set the temperature range to between 65 and 70 degrees*. (in auto mode, for systems that can heat and cool)
* Hey Siri, *set the thermostat to cool*. (try heat, cool, auto, or off)
* Hey Siri, *turn on the air conditioning*.
* Hey Siri, *turn Eco Mode on*.
* Hey Siri, *what's the temperature at home*?
* Hey Siri, *what's the temperature in the Basement*? (get the temperature from a Nest Temperature Sensor)
* Hey Siri, *what's the status of my smoke detector*?

# Donate to Support homebridge-nest

homebridge-nest is a labour of love. It's provided under the ISC licence and is completely free to do whatever you want with. But if you'd like to show your appreciation for its continued development, please consider [clicking here to make a small donation](https://paypal.me/adriancable586) or send me a thank-you card:

Adrian Cable  
PO Box 370365  
Montara, CA 94037  

I appreciate your feedback and support in whatever form!
