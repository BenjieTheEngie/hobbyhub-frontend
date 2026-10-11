import test from 'node:test';import assert from 'node:assert/strict';import {validateMarketplaceListingIdentity} from '../backend/marketplace-listing-uniqueness.mjs';
test('same SKU is valid across separate listings',()=>assert.equal(validateMarketplaceListingIdentity([{listingId:'a',sellerId:'s1',sku:'BOLT'},{listingId:'b',sellerId:'s2',sku:'BOLT'}]).count,2));
test('duplicate listing IDs are forbidden',()=>assert.throws(()=>validateMarketplaceListingIdentity([{listingId:'a',sellerId:'s1'},{listingId:'a',sellerId:'s2'}]),/duplicate/));
