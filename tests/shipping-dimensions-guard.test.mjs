import test from 'node:test';import assert from 'node:assert/strict';import {verifyMeasuredParcel} from '../backend/shipping-dimensions-guard.mjs';
const p={measurementSource:'seller-measured',weightOz:4,lengthIn:7,widthIn:5,heightIn:1};
test('physical measurement provenance is required',()=>assert.equal(verifyMeasuredParcel({...p,measurementSource:'estimate'}).verified,false));
test('measured dimensions pass',()=>assert.equal(verifyMeasuredParcel(p).verified,true));
test('invalid weight blocks',()=>assert.equal(verifyMeasuredParcel({...p,weightOz:0}).verified,false));
