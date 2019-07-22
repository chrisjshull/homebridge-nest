/**
 * Created by Adrian Cable on 7/21/19.
 */

'use strict';

module.exports = NestMutex;

function NestMutex() {
    this.apiUpdateCallsPending = 0;
    this.apiTemperatureSetPending = [false, false, false, false, false];
}

NestMutex.prototype.updateStates = {
    targetTemperature: 0,
    coolingThresholdTemperature: 1,
    heatingThresholdTemperature: 2,
    targetHeatingCooling: 3,
    ecoMode: 4
}

NestMutex.prototype.isApiUpdatePending = function() {
    return (this.apiUpdateCallsPending > 0);
}

NestMutex.prototype.isTemperatureUpdatePending = function() {
    return (this.apiTemperatureSetPending.some(el => el));
}

NestMutex.prototype.startApiUpdate = function() {
    this.apiUpdateCallsPending++;
    console.log('api calls pending: ', this.apiUpdateCallsPending);
}

NestMutex.prototype.endApiUpdate = function() {
    this.apiUpdateCallsPending--;
    console.log('api calls pending: ', this.apiUpdateCallsPending);
}

NestMutex.prototype.startTemperatureUpdate = function(tuType) {
    this.apiTemperatureSetPending[tuType] = true;
    console.log('temperature set pending: ', tuType, this.apiTemperatureSetPending[tuType]);
}

NestMutex.prototype.endTemperatureUpdate = function(tuType) {
    this.apiTemperatureSetPending[tuType] = false;
    console.log('temperature set pending: ', tuType, this.apiTemperatureSetPending[tuType]);
}