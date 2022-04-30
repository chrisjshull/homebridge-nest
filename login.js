// Based on login.ts from homebridge-nest-cam - thank you, @Brandawg93!

const readline = require('readline');
const querystring = require('querystring');
const axios = require('axios');

// Timeout other API calls after this number of seconds
const API_TIMEOUT_SECONDS = 40;

// URL for refresh token generation
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Client ID of the Nest iOS application
const CLIENT_ID = '733249279899-1gpkq9duqmdp55a7e5lft1pr2smumdla.apps.googleusercontent.com';

// Client ID of the Test Flight Beta Nest iOS application
const CLIENT_ID_FT = '384529615266-57v6vaptkmhm64n9hn5dcmkr4at14p8j.apps.googleusercontent.com';

const NestEndpoints = require('./lib/nest-endpoints.js');

const prompt = query =>
    // eslint-disable-next-line no-async-promise-executor
    new Promise(async (resolve, reject) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        try {
            rl.question(query, value => {
                resolve(value);
                rl.close();
            });
        } catch (err) {
            reject(err);
        }
    });

/**
 * Generate url required to retrieve a refresh token
 */
function generateToken(ft = false) {
    const data = {
        access_type: 'offline',
        response_type: 'code',
        scope: 'openid profile email https://www.googleapis.com/auth/nest-account',
        redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
        client_id: ft ? CLIENT_ID_FT : CLIENT_ID,
    };
    return `https://accounts.google.com/o/oauth2/auth/oauthchooseaccount?${querystring.stringify(data)}`;
}

async function getRefreshToken(code, ft = false) {
    const req = {
        method: 'POST',
        timeout: API_TIMEOUT_SECONDS * 1000,
        url: TOKEN_URL,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': NestEndpoints.USER_AGENT_STRING,
        },
        data: querystring.stringify({
            code: code,
            redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
            client_id: ft ? CLIENT_ID_FT : CLIENT_ID,
            grant_type: 'authorization_code',
        }),
    };
    const result = (await axios(req)).data;
    return result.refresh_token;
}

(async () => {
    const ft = process.argv.includes('-ft');
    const url = generateToken(ft);
    console.log(`1. Open the url below in a browser to continue:\n\n${url}\n`);
    const code = await prompt('2. Copy the authorization code from the browser, and paste it here: ');
    try {
        const refreshToken = await getRefreshToken(code, ft);
        console.log('3. Copy the refresh token below (without any spaces at the beginning or end) to your config.json.');
        console.log(`Refresh Token: ${refreshToken}`);
    } catch (err) {
        let msg = err;
        if (err.response && err.response.data && err.response.data.error_description) {
            msg = err.response.data.error_description;
        } else if (err.message) {
            msg = err.message;
        }
        console.error(msg);
    }
})();
