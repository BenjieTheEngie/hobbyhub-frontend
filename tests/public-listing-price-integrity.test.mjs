import test from 'node:test';import assert from 'node:assert/strict';import {publicListingPriceIntegrity} from '../backend/public-listing-price-integrity.mjs';
test('750 cents matches seller-confirmed $7.50',()=>assert.equal(publicListingPriceIntegrity({salePrice:7.5},750).valid,true));
test('floating price drift blocks',()=>assert.equal(publicListingPriceIntegrity({salePrice:7.505},750).valid,false));
test('negative price blocks',()=>assert.equal(publicListingPriceIntegrity({salePrice:-1},100).valid,false));
