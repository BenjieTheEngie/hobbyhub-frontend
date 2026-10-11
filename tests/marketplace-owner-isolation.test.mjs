import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeListingOwner} from '../backend/marketplace-owner-isolation.mjs';
const listing={listingId:'listing-a',sellerId:'seller-a',sku:'MTG-SLD-7-F',status:'DRAFT'};
test('only verified owner can change independently stocked listing',()=>{
 for(const action of ['edit-draft','adjust-stock','request-approval'])
 assert.equal(authorizeListingOwner({actorSellerId:'seller-a',listing,action}).allowed,true);
});
test('identical SKU never authorizes another seller',()=>{
 const another={...listing,listingId:'listing-b',sellerId:'seller-b'};
 assert.equal(authorizeListingOwner({actorSellerId:'seller-a',listing:another,action:'adjust-stock'}).allowed,false);
});
test('legacy listings with no explicit seller ownership are blocked',()=>{
 assert.equal(authorizeListingOwner({actorSellerId:'seller-a',listing:{...listing,sellerId:undefined},action:'adjust-stock'}).allowed,false);
 assert.equal(authorizeListingOwner({actorSellerId:'',listing,action:'adjust-stock'}).allowed,false);
});
test('published listings cannot be edited through draft-only action',()=>{
 assert.equal(authorizeListingOwner({actorSellerId:'seller-a',listing:{...listing,status:'ACTIVE'},action:'edit-draft'}).allowed,false);
});
