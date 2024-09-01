// Nest endpoint URLs for production and field test services

'use strict';

// We want to look like a browser
const USER_AGENT_STRING = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.120 Safari/537.36';
// const USER_AGENT_STRING = 'Mozilla/5.0 (Linux; U; Android 8.1.0; en-US; Nexus 6P Build/OPM7.181205.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/57.0.2987.108 UCBrowser/12.11.1.1197 Mobile Safari/537.36';

const endpoint = {};

endpoint.init = function(fieldTestMode) {
    let apiHostname, cameraApiHostname, grpcHostname, camAuthCookie;

    if (fieldTestMode) {
        apiHostname = 'home.ft.nest.com';
        cameraApiHostname = 'webapi.camera.home.ft.nest.com';
        grpcHostname = 'grpc-web.ft.nest.com';
        camAuthCookie = 'website_ft';
    } else {
        apiHostname = 'home.nest.com';
        cameraApiHostname = 'webapi.camera.home.nest.com';
        grpcHostname = 'grpc-web.production.nest.com';
        camAuthCookie = 'website_2';
    }

    endpoint.USER_AGENT_STRING = USER_AGENT_STRING;
    endpoint.NEST_API_HOSTNAME = apiHostname;
    endpoint.CAMERA_API_HOSTNAME = cameraApiHostname;
    endpoint.CAMERA_AUTH_COOKIE = camAuthCookie;

    // Rest API endpoints
    endpoint.URL_NEST_AUTH = 'https://' + apiHostname + '/session';
    endpoint.URL_NEST_VERIFY_PIN = 'https://' + apiHostname + '/api/0.1/2fa/verify_pin';
    endpoint.ENDPOINT_PUT = '/v5/put';
    endpoint.ENDPOINT_SUBSCRIBE = '/v5/subscribe';

    // Protobuf API endpoints
    endpoint.URL_PROTOBUF = 'https://' + grpcHostname;
    endpoint.ENDPOINT_OBSERVE = '/nestlabs.gateway.v2.GatewayService/Observe';
    endpoint.ENDPOINT_UPDATE = '/nestlabs.gateway.v1.TraitBatchApi/BatchUpdateState';
    endpoint.ENDPOINT_SENDCOMMAND = '/nestlabs.gateway.v1.ResourceApi/SendCommand';
};

module.exports = endpoint;
