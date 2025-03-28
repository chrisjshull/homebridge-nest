# homebridge-nest

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![Discord](https://img.shields.io/discord/432663330281226270?color=728ED5&logo=discord&label=discord)](https://discord.gg/j5WwJTB)

Nest plug-in for [Homebridge](https://github.com/nfarina/homebridge) using the native Nest API. See what's new in [release 4.6.10](https://github.com/chrisjshull/homebridge-nest/releases/tag/v4.6.10).

Integrate your Nest Thermostat, Temperature Sensors, Nest Protect, and Nest x Yale Lock devices into your HomeKit system. Both Nest Accounts (pre-August 2019) and Google Accounts are supported.

Currently, homebridge-nest supports all Nest Thermostat, Protect, and Nest x Yale Lock models, including the EU/UK model of the Thermostat E with Heat Link and the October 2020 model Nest Thermostat with mirror display.

We do not support the discontinued Nest Secure system. We also do not support cameras - but for that, there is the excellent [homebridge-nest-cam](https://github.com/Brandawg93/homebridge-nest-cam) plug-in.

# Starling Home Hub

If you want a plug-and-play Nest integration solution, check out [Starling Home Hub](https://www.starlinghome.io). It's a little box that connects to your home router, so you'll be up and running in minutes without needing to set up a Homebridge server, manually edit configuration files, or worry about authentication tokens. Starling Home Hub also supports Nest Cameras (including the August 2021 battery-powered models) and Nest Secure (Guard and Detects).

If you want a DIY solution, then read on, as homebridge-nest is for you!

# Installation

<!-- 2. Clone (or pull) this repository from github into the same path Homebridge lives (usually `/usr/local/lib/node_modules`). Note: the code currently on GitHub is in beta, and is newer than the latest published version of this package on `npm` -->
1. Install homebridge using: `npm install -g homebridge`
2. Install this plug-in using: `npm install -g homebridge-nest`
3. Update your configuration file. See example `config.json` snippet below.

# Configuration

Configuration sample (edit `~/.homebridge/config.json`):

```
"platforms": [
        {
            "platform": "Nest",
            "options": [ "HomeAway.Disable" ],
            "access_token": "your Nest Account access token"
        }
    ],
```

Required fields when using a Nest Account with an access token: (see below for set-up info)

* `"platform"`: Must always be `"Nest"`
* `"access_token"`: Nest service access token

Required fields when using a Google Account with a refresh token: (see below for set-up info)

* `"platform"`: Must always be `"Nest"`
* `"refreshToken"`: Google refresh token

Required fields when using a Google Account with cookies: (see below for set-up info)

* `"platform"`: Must always be `"Nest"`
* `"googleAuth"`: Google authentication information

Optional fields:

* `"structureId"`: `"your structure's ID"` // optional structureId to filter to (see logs on first run for each device's structureId) - Nest "structures" are equivalent to HomeKit "homes"
* `"options"`: `[ "feature1", "feature2", ... ]` // optional list of features to enable/disable (see 'Feature Options' below)
* `"fanDurationMinutes"`: number of minutes to run the fan when manually turned on (optional, default is `15`)
* `"hotWaterDurationMinutes"`: number of minutes to run the hot water when manually turned on (optional, default is `30`, only for systems with hot water control)

# Using a Nest Account

To use a Nest Account with homebridge-nest, you will need to obtain an access token from the Nest web app. (Note - no Nest developer account is required.) Simply go to `https://home.nest.com` in your browser and log in. Once that's done, go to `https://home.nest.com/session` in your browser, and you will see a long string that looks like this:

```
{"2fa_state":"not_enrolled","access_token":"XXX","email":"...","expires_in":"...", ...}
```

Simply set `"access_token"` in your `config.json` file under the `"platform": "Nest"` entry to the value of `access_token` near the start of the string (the `XXX`), which will be a long sequence of letters, numbers and punctuation beginning with `b`. There may be other keys labelled `access_token` further along in the string - please ignore these.

Do not log out of `home.nest.com`, as this will invalidate your credentials. Just close the browser tab.

# Using a Google Account

Google Accounts (mandatory for new Nest devices after August 2019, with an optional migration for earlier accounts) are fully supported.

(Note: the plug-in used to support two ways to authenticate with Google, the refresh token method and the cookies method. The refresh token method
no longer works due to Google-side changes in October 2022, so now we only document the cookies method.)

Using the cookies method, Google Accounts are configured using the `"googleAuth"` object in `config.json`, which contains two fields, `"issueToken"` and `"cookies"`, which looks like this:

```
      "platform": "Nest",
      "googleAuth": {
        "issueToken": "https://accounts.google.com/o/oauth2/iframerpc?action=issueToken...",
        "cookies": "OCAK=TOMPYI3cCPAt...; SID=ogftnk...; HSID=ApXSR...; ...; SIDCC=AN0-TYt..."
      },
```

The values of `"issueToken"` and `"cookies"` are specific to your Google Account. To get them, follow these steps (only needs to be done once, as long as you stay logged into your Google Account).

### Chrome

1. Open a Chrome browser tab in Incognito Mode (or clear your cache).
2. Open Developer Tools (View/Developer/Developer Tools).
3. Click on 'Network' tab. Make sure 'Preserve Log' is checked.
4. In the 'Filter' box, enter `issueToken`.
5. Go to `home.nest.com` then click the "eye" icon in top right of the address bar and click the toggle for "Third-party cookies".
6. Click 'Sign in with Google'. Log into your account.
7. One network call (beginning with `iframerpc`) will appear in the Dev Tools window. Click on it.
8. In the Headers tab, under General, copy the entire `Request URL` (beginning with `https://accounts.google.com`). This is your `"issueToken"` in `config.json`.
9. In the 'Filter' box, enter `oauth2/iframe`
10. Several network calls will appear in the Dev Tools window. Click on the last `iframe` call.
11. In the Headers tab, under Request Headers, copy the entire `cookie` (**include the whole string which is several lines long and has many field/value pairs** - do not include the `cookie:` name). This is your `"cookies"` in `config.json`.
12. Do not log out of `home.nest.com`, as this will invalidate your credentials. Just close the browser tab.

### Safari

1. Open a Safari browser tab in Incognito Mode
2. Open Developer Tools (Develop > Show Javascript Console, if you don't see this choose Safari > Settings, click Advanced, then select “Show features for web developers.” first)
3. Click on 'Network' tab. Tap the second filter icon next to the "All" dropdown to select "Preserve Log". This ensures the logs don't get cleared when redirects happen.
4. In the 'Filter' box, enter `issueToken`
5. Go to `home.nest.com`, and click 'Sign in with Google'. Log into your account.
6. One network call (beginning with `iframerpc`) will appear in the Dev Tools window. Click on it.
7. Under Headers > Summary, copy the URL (beginning with `https://accounts.google.com`). This is your `"issueToken"` in `config.json`.
<img width="762" alt="Screenshot 2024-10-30 at 09 14 38" src="https://github.com/user-attachments/assets/0e65b5a3-018a-4ca0-8bac-e3c4c52016a0">

8. In the 'Filter' box, enter `oauth2/iframe`
9. Several network calls will appear in the Dev Tools window. Click on the most recent (usually top-most) `iframe` call.
10. Under Headers > Request, copy the entire `cookie` (**include the whole string which is several lines long and has many field/value pairs** - do not include the `cookie: ` name). This is your `"cookies"` in `config.json`.
<img width="762" alt="Screenshot 2024-10-30 at 09 22 15" src="https://github.com/user-attachments/assets/c802201b-463c-4e78-9fa9-f2ed4f60fffe">

11. Do not log out of `home.nest.com`, as this will invalidate your credentials. Just close the browser tab.

# HomeKit Accessory Types

## Home

* *Switch* accessory (Home Occupied) indicating detected Home/Away state - can be manually changed

## Nest Thermostat (+ Temperature Sensors)

* *Thermostat* accessory with ambient temperature and humidity sensors, mode control (heat/cool/auto/off), and target temperature control
* *Switch* accessory (Eco Mode) for turning on and off Eco Mode
* *Fan* accessory for controlling the fan (except the EU/UK model of the Nest Thermostat E, which does not have a fan control)
* *TemperatureSensor* accessory indicating the ambient temperature at the thermostat (disabled by default if no Temperature Sensors are present - temperature is reported by the base *Thermostat* accessory)
* *TemperatureSensor* accessory indicating the ambient temperature where each additional Nest Temperature Sensor is located
* *HumiditySensor* accessory indicating the relative humidity at the thermostat (disabled by default - humidity is reported by the base *Thermostat* accessory)

## Nest Protect

* *SmokeSensor* accessory (Smoke) indicating smoke detected
* *CarbonMonoxideSensor* accessory (Carbon Monoxide) indicating CO detected
* *OccupancySensor* accessory (Motion) indicating occupancy detected near the Protect device (AC wired Protects only)

## Nest x Yale Lock

* *LockMechanism* accessory

# Feature Options

Set `"options"` in `config.json` to an array of strings chosen from the following to customise feature options:

* `"Thermostat.Disable"` - exclude Nest Thermostats from HomeKit
* `"Thermostat.Fan.Disable"` - do not create a *Fan* accessory for the thermostat
* `"Thermostat.Eco.Disable"` - do not create a *Switch* accessory to indicate/control Eco Mode status
* `"Thermostat.SeparateBuiltInTemperatureSensor.Enable"` - create an additional *TemperatureSensor* accessory to report the ambient temperature at the thermostat
* `"Thermostat.SeparateBuiltInHumiditySensor.Enable"` - create an additional *HumiditySensor* accessory to report the relative humidity at the thermostat
* `"Thermostat.EcoMode.ChangeEcoBands.Enable"` - when set, changing temperature in Eco Mode changes Eco Temperature Bands (default is to turn off Eco Mode instead before setting temperature)
* `"TempSensor.Disable"` - exclude Nest Temperature Sensors from HomeKit
* `"HomeAway.Disable"` - exclude Home/Away switch from HomeKit
* `"HomeAway.AsOccupancySensor"` - create Home/Away indicator as an *OccupancySensor* instead of a *Switch* - useful for automations
* `"HomeAway.AsOccupancySensorAndSwitch"` - create Home/Away indicator as an *OccupancySensor* and a *Switch*
* `"Protect.Disable"` - exclude Nest Protects from HomeKit
* `"Protect.MotionSensor.Disable"` - disable *MotionDetector* accessory for Nest Protects
* `"Lock.Disable"` - exclude Nest x Yale Locks from HomeKit
* `"Nest.FieldTest.Enable"` - set this option if you're using a Nest Field Test account (experimental)

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
* Hey Siri, *unlock my Front Door*.

# Donate to Support homebridge-nest

homebridge-nest is a labour of love. It's provided under the ISC licence and is completely free to do whatever you want with. But if you'd like to show your appreciation for its continued development, please consider [clicking here to make a small donation](https://paypal.me/adriancable586) or, even better, send me a thank-you card:

Adrian Cable  
PO Box 370365  
Montara, CA 94037  

I appreciate your feedback and support in whatever form!
