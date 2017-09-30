# homebridge-nest
Nest plugin for [HomeBridge](https://github.com/nfarina/homebridge)

This repository contains the Nest plugin for homebridge that was previously bundled in the main `homebridge` repository. 

# Installation


1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-nest
3. Update your configuration file. See sample-config.json snippet below. 

It is **Strongly advised that you switch to the new API** but it is not required at the moment.  It will fall back to the old API, but **no new development will be done on the old API**. 

Until an alternative is determined (like Nest Weave which hasn't been released yet or setting up a website for generating tokens specifically for HomeBridge-Nest), you will have to setup an developer account for Nest.  Its a simple process and if you specify that it is for Individual, then you are auto approved (at least in my experience).

_WARNING: Switching to the new API means it will show up as brand new device.  This is due to the fact that the unofficial API used a different device id and we have no way to link it to the official cloud device id. This means any configurations, alarms, scenes, etc to which the Nest was associated will have need to be updated with the new Nest device._

_Note: The name of the device will change as well.  It matches the name displayed in the Nest app.  In my case, I originally configured the Nest app so the the "Where" of my Nest was "Hallway" and I also added a label which was "Nest", so the display was "Hallway (Nest)".  To fix the name to say "Nest", you can use the Nest app and blank out the "Label" and use the custom "Where" of "Nest". Anther option to fix the name is through HomeKit.  HomeKit allows you to rename Accessories and Services, but it requires an app like [Insteon+](https://itunes.apple.com/us/app/insteon+/id919270334?uo=2&at=11la2C) that has the ability to change the name._


## How to Setup New API 

1. Go to [https://developer.nest.com](https://developer.nest.com)
2. Choose **Sign In**
3. Use your normal account to sign in
4. Fill in you info in 'Step 1'
5. In 'Step 2' set:
	* **Company Name**: _HomeBridge-Nest_
	* **Company URL**: _https://github.com/kraigm/homebridge-nest_
	* **Country**: _[Your Country]_
	* **Size of Company**: _Individual_
6. Then just agree to the terms and submit
7. Go to **Products** and create a new product
8. Fill in:
	* **Product Name**: _HomeBridge_ + your name (must be unique)
	* **Description**: _Open source project to provide HomeKit integration_
	* **Categories**: _Home Automation_
	* **Users**: _Individual_
	* **Support URL**: _https://github.com/kraigm/homebridge-nest_
	* **Redirect URL**:  _[LEAVE BLANK]_
	* **Permissions (minimum)**: 
		* Enable **Thermostat** with **read/write v4**
		* Enable **Away** with **read/write v2**
		* Enable **Smoke+CO alarm** with **read v4** (if you ever might want Nest Protect)
		* Enable **Camera** with **read v2** (if you ever might want Nest Cam, motion detection only)
		* Permission description: fill in anything
9. Now you should have a product. Now locate the id/secret section on the right of your product's page
10. Copy the **Product ID** to your HomeBridge config as the **clientId** in the Nest config
11. Copy the **Product Secret** to your HomeBridge config as the **clientSecret** in the Nest config
12. Navigate to the **Authorization URL**
13. Accept the terms and copy the **Pin Code** to your HomeBridge config as the **code** in the Nest config
14. Run HomeBridge once _(do not include the **token** in the config at this time)_ and you should find a log that says something like _"CODE IS ONLY VALID ONCE! Update config to use {'token':'c.5ABsTpo88k5yfNIxZlh...'} instead."_  Copy the **_c.5ABsTpo88k5yfNIxZlh..._** portion to your HomeBridge config as the **token** in the Nest config
15. You should be able to **restart HomeBridge** and it should succeed with the new token.

After that you will be **FINALLY** done (Huzzah!). If the token is working correctly, you no longer NEED the other three configs (clientId, clientSecret, and code) nor the original username and password from the legacy system (but you can keep them around if you wish, they will be ignored).




# Configuration

Configuration sample:

 ```
"platforms": [
		{
			"platform": "Nest",
			
			"token" : "token will be generated upon first run of homebridge without a token",
			
			"clientId": "developer Product ID",
			"clientSecret": "developer Product Secret.",
			"code": "your Pincode from Nest",
			
			"username" : "username",
			"password" : "password"
		}
	],

```

Fields: 

* "platform": Must always be "Nest" (required)
* "token": The only (and final) authentication piece you need to use the new API (required for new api, after determined)

* "clientId": Can be anything (required for new api, if token not yet determined)
* "clientSecret": Can be anything (required for new api, if token not yet determined)
* "code": Can be anything (required for new api if trying to determine token)


Legacy Fields: 

* "username": Nest login username, same as app (required for legacy api)
* "password": Nest login password, same as app (required for legacy api)

