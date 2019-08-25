# homebridge-nest
Nest plug-in for [Homebridge](https://github.com/nfarina/homebridge) using the native Nest API. See what's new in [release 3.4.1](https://github.com/chrisjshull/homebridge-nest/releases/tag/v3.4.1).

Integrate your Nest Thermostat (including Nest Temperature Sensors) and Nest Protect devices into your HomeKit system. Both Nest Accounts (pre-August 2019) and Google Accounts are supported.

Currently, homebridge-nest supports all Nest Thermostat and Nest Protect models, except the UK model of the Thermostat E with Heat Link. Camera and Nest Secure/Detect support may come later. (I don't currently own those devices.)

# Installation

<!-- 2. Clone (or pull) this repository from github into the same path Homebridge lives (usually `/usr/local/lib/node_modules`). Note: the code currently on GitHub is in beta, and is newer than the latest published version of this package on `npm` -->
1. Install homebridge using: `npm install -g homebridge`
2. Install this plug-in using: `npm install -g homebridge-nest`
3. Update your configuration file. See example `config.json` snippet below.

You will need your Nest Account (or Google Account) email address and password - the same credentials you use with the Nest app. A 'Works With Nest' developer account and tokens are not required.

# Configuration

Configuration sample (edit `~/.homebridge/config.json`):

```
"platforms": [
        {
            "platform": "Nest",
            "email": "your Nest Account email address",
            "password": "your Nest Account password"
        }
    ],
```

Required fields when using a Nest Account:

* `"platform"`: Must always be `"Nest"`
* `"email"`: Your Nest Account email address
* `"password"`: Your Nest Account password

Required fields when using a Google Account: (see below for set-up info)

* `"platform"`: Must always be `"Nest"`
* `"googleAuth"`: Google authentication information (see below)

Required fields when using access token: (see below - you probably won't need this mode)

* `"platform"`: Must always be `"Nest"`
* `"access_token"`: Nest service access token

Optional fields:

* `"pin"`: `"number"` // PIN code sent to your mobile device for 2-factor authentication - see below (optional)
* `"structureId"`: `"your structure's ID"` // optional structureId to filter to (see logs on first run for each device's structureId) - Nest "structures" are equivalent to HomeKit "homes"
* `"options"`: `[ "feature1", "feature2", ... ]` // optional list of features to enable/disable (see below)
* `"fanDurationMinutes"`: number of minutes to run the fan when manually turned on (optional, default is 15)

# Using a Nest Account

Simply set `"email"` to your Nest Account email address, and `"password"` to your Nest Account password.

Two-factor authentication is supported if enabled in your Nest Account. On starting Homebridge, you will be prompted to enter a PIN code which will be sent to the mobile device number registered to your Nest Account.

If you are running Homebridge as a service, you cannot manually enter the PIN in the console. In this case, when you start Homebridge and receive the PIN code, edit `config.json` and add the PIN received under `"pin"` (see 'Configuration' above). Then, restart Homebridge. Using 2FA is not recommended if Homebridge is run as a service, because if the connection to the Nest service is interrupted for any reason, homebridge-nest will not be able to automatically reconnect.

# Using a Google Account

Google Accounts (mandatory for new Nest devices after August 2019, with an optional migration for earlier accounts) are now supported. Setting up a Google Account with homebridge-nest is a pain, but only needs to be done once, as long as you don't log out of your Google Account.

Google Accounts are configured using the `"googleAuth"` object in `config.json`, which contains three fields, `"issueToken"`, `"cookies"` and `"apiKey"`, and looks like this:

```
      "googleAuth": {
        "issueToken": "https://accounts.google.com/o/oauth2/iframerpc?action=issueToken...",
        "cookies": "OCAK=TOMPYI3cCPAt...",
        "apiKey": "AIzaS..."
      },
```

The values of `"issueToken"`, `"cookies"` and `"apiKey"` are specific to your Google Account. To get them, follow these steps (only needs to be done once, as long as you stay logged into your Google Account).

1. Open a Chrome browser tab in Incognito Mode (or clear your cache).
2. Open Developer Tools (View/Developer/Developer Tools).
3. Click on 'Network' tab. Make sure 'Preserve Log' is checked.
4. In the 'Filter' box, enter `issueToken`
5. Go to `home.nest.com`, and click 'Sign in with Google'. Log into your account.
6. One network call (beginning with `iframerpc`) will appear in the Dev Tools window. Click on it.
7. In the Headers tab, under General, copy the entire `Request URL` (beginning with `https://accounts.google.com`, ending with `nest.com`). This is your `"issueToken"` in `config.json`.
8. In the 'Filter' box, enter `oauth2/iframe`
9. Several network calls will appear in the Dev Tools window. Click on the last `iframe` call.
10. In the Headers tab, under Request Headers, copy the entire `cookie` (beginning with `OCAK=...` - do not include the `cookie:` name). This is your `"cookies"` in `config.json`.
11. In the 'Filter' box, enter `issue_jwt`
12. Click on the last `issue_jwt` call.
13. In the Headers tab, under Request Headers, copy the entire `x-goog-api-key` (do not include the `x-goog-api-key:` name). This is your `"apiKey"` in `config.json`.

# Access Token Mode

If you use a Nest Account, as an alternative to specifying `"email"` and `"password"` in `config.json`, you may provide an `"access_token"` instead. This may be useful, for example, if your primary account has 2FA enabled and you are running Homebridge in a Docker container or similar where you cannot enter a PIN when Homebridge starts.

To generate the access token, the easiest way is to use the `generateNestToken.sh` script. It will ask for your email and password (and if you have 2FA enabled, the SMS code). Alternatively, you can log into `home.nest.com` from your browser and extract the token from the response of the `session` API call.

However, we don't recommend this usage - if the token expires, homebridge-nest will not be able to automatically reconnect. Instead, we recommend you use Nest's Family Sharing feature to create an alternative login to the service without 2FA, and use those credentials for homebridge-nest.

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

By default, options set apply to all devices. To set an option for a specific device only, add `.device_id` to the corresponding `option`, where `device_id` is shown in the Homebridge logs, or in HomeKit itself as *Serial Number* in the Settings page for your device. For example, to disable one specific thermostat with serial number 09AC01AC31180349, add `"Thermostat.Disable.09AC01AC31180349"` to the `"options"` array.

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
