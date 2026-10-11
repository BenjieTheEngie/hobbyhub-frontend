import test from 'node:test';
import assert from 'node:assert/strict';
import {marketplaceListingPreview} from '../backend/marketplace-listing-preview.mjs';
const product=(productId,sku,price,published=true)=>({
 productId,sku,productName:'Lightning Bolt',status:'ACTIVE',
 published,salePrice:price,category:'Magic: The Gathering',finish:'party-foil'});
const stock=(productId,qty)=>({productId,quantityOnHand:qty,reserved:0,
 quantityAvailable:qty,reorderPoint:0,version:1});
test('independent approved sellers may offer identical card SKU without stock mixing',()=>{
 const items=marketplaceListingPreview([product('sellerA-listing','MTG-SLD-7-F',7.50),
 product('sellerB-listing','MTG-SLD-7-F',8.00)],
 [stock('sellerA-listing',1),stock('sellerB-listing',3)]);
 assert.deepEqual(items.map(x=>[x.listingId,x.sku,x.quantityOnHand,x.salePrice]),[
 ['sellerA-listing','MTG-SLD-7-F',1,7.50],['sellerB-listing','MTG-SLD-7-F',3,8.00]]);
});
test('unapproved or unstocked listing is not displayed',()=>{
 assert.deepEqual(marketplaceListingPreview([product('a','SAME',7.50,false),
 product('b','SAME',8)], [stock('a',1),stock('b',0)]),[]);
});
test('duplicate listing IDs and corrupt stock fail closed',()=>{
 assert.throws(()=>marketplaceListingPreview([product('a','SAME',7),product('a','SAME',8)],[stock('a',1)]),/Duplicate/);
 assert.throws(()=>marketplaceListingPreview([product('a','SAME',7)],[stock('a',1),stock('a',1)]),/duplicate/);
 assert.throws(()=>marketplaceListingPreview([product('a','SAME',7)],[{...stock('a',1),quantityAvailable:3}]),/Invalid/);
 assert.throws(()=>marketplaceListingPreview(null,[]),/Complete/);
});
