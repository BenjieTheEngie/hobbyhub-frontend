import test from 'node:test';import assert from 'node:assert/strict';import {checkoutShippingGate} from '../backend/checkout-shipping-gate.mjs';
const p={measurementSource:'seller-measured',country:'US',fulfillment:'shipping',postalCode:'02382',weightOz:4,lengthIn:7,widthIn:5,heightIn:1};
test('unquoted parcel cannot checkout',()=>assert.equal(checkoutShippingGate(p).ready,false));
test('quote and physical measurement pass readiness',()=>assert.equal(checkoutShippingGate({...p,carrierQuoteId:'rate_test'}).ready,true));
