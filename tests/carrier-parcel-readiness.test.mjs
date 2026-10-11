import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCarrierParcel} from '../backend/carrier-parcel-readiness.mjs';
const parcel={country:'US',fulfillment:'shipping',postalCode:'02382',weightOz:4,
 lengthIn:7,widthIn:5,heightIn:1};
test('carrier-calculated checkout requires a real carrier quote ID',()=>{
 assert.deepEqual(validateCarrierParcel(parcel),{ready:false,reason:'CARRIER_QUOTE_REQUIRED',country:'US',fulfillment:'shipping'});
 assert.equal(validateCarrierParcel({...parcel,carrierQuoteId:'rate_test_123'}).ready,true);
});
test('non-US shipping and local pickup are rejected',()=>{
 assert.throws(()=>validateCarrierParcel({...parcel,country:'CA'}),/United States/);
 assert.throws(()=>validateCarrierParcel({...parcel,fulfillment:'pickup'}),/shipped orders/);
});
test('invalid weight, dimensions and ZIP are rejected',()=>{
 for(const patch of [{weightOz:0},{lengthIn:0},{widthIn:-1},{heightIn:Infinity},{postalCode:'ABC'}])
 assert.throws(()=>validateCarrierParcel({...parcel,...patch}),/required/);
});
