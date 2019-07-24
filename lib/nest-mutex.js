/**
 * Created by Adrian Cable on 7/21/19.
 */

'use strict';

module.exports = NestMutex;

function NestMutex(log) {
    this.log = log;
    this.apiUpdateCallsPending = 0;
    this.apiPropertySetPending = [false, false, false, false, false, false];
}

NestMutex.prototype.updateStates = {
    targetTemperature: 0,
    coolingThresholdTemperature: 1,
    heatingThresholdTemperature: 2,
    targetHeatingCooling: 3,
    ecoMode: 4,
    homeAwayMode: 5
};

NestMutex.prototype.isApiUpdatePending = function() {
    return (this.apiUpdateCallsPending > 0);
};

NestMutex.prototype.isTemperatureUpdatePending = function() {
    return (this.apiPropertySetPending.some(el => el));
};

NestMutex.prototype.startApiUpdate = function() {
    this.apiUpdateCallsPending++;
    this.log.debug('api calls pending:', this.apiUpdateCallsPending);
};

NestMutex.prototype.endApiUpdate = function() {
    this.apiUpdateCallsPending--;
    this.log.debug('api calls pending:', this.apiUpdateCallsPending);
};

NestMutex.prototype.startPropertyUpdate = function(tuType) {
    this.apiPropertySetPending[tuType] = true;
    this.log.debug('property set pending:', Object.keys(this.updateStates)[tuType], this.apiPropertySetPending[tuType]);
};

NestMutex.prototype.endPropertyUpdate = function(tuType) {
    this.apiPropertySetPending[tuType] = false;
    this.log.debug('property set pending:', Object.keys(this.updateStates)[tuType], this.apiPropertySetPending[tuType]);
};
