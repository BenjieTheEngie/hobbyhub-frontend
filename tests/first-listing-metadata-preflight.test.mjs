import test from 'node:test';
import assert from 'node:assert/strict';
import {firstListingMetadataPreflight} from '../backend/first-listing-metadata-preflight.mjs';
const id='prd_9bfd1285-899c-45cb-869c-6058aff5b424';
const expected={productId:id,productName:'Lightning Bolt',finish:'party-foil'};
test('real legacy Lightning Bolt row lacks verified Party Foil metadata',()=>{
 const r=firstListingMetadataPreflight({productId:id,productName:'Lightning Bolt',salePrice:7.5,status:'ACTIVE'},expected);
 assert.equal(r.verified,false);
 assert.deepEqual(r.missing,['finish']);
});
test('matching metadata can be verified without mutation',()=>{
 const r=firstListingMetadataPreflight({...expected},expected);
 assert.equal(r.verified,true);
});
test('different foil or product identity fails closed',()=>{
 const r=firstListingMetadataPreflight({...expected,finish:'foil',productId:'other'},expected);
 assert.deepEqual(r.mismatched,['productId','finish']);
});
test('missing exact product or finish expectations are rejected',()=>{
 assert.throws(()=>firstListingMetadataPreflight({...expected},{productName:'Lightning Bolt',finish:'party-foil'}),/productId/);
 assert.throws(()=>firstListingMetadataPreflight({...expected},{productId:id,productName:'Lightning Bolt'}),/finish/);
});
