import test from 'node:test';import assert from 'node:assert/strict';import {verifyFirstListingIdentity} from '../backend/first-listing-identity-lock.mjs';
const p={productId:'prd_9bfd1285-899c-45cb-869c-6058aff5b424',sku:'MTG-SLD-IFIYW-7-F',productName:'Lightning Bolt',salePrice:7.50};
test('only exact original listing is accepted',()=>assert.equal(verifyFirstListingIdentity(p).verified,true));
test('other same-SKU offer cannot pass',()=>assert.equal(verifyFirstListingIdentity({...p,productId:'other'}).verified,false));
test('price drift fails closed',()=>assert.equal(verifyFirstListingIdentity({...p,salePrice:8}).verified,false));
