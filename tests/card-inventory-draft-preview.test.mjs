import test from 'node:test';
import assert from 'node:assert/strict';
import {previewCardInventoryDrafts} from '../backend/card-inventory-draft-preview.mjs';
const card={game:'Magic: The Gathering',productName:'Lightning Bolt',sku:'MTG-LB-001',
  setCode:'M11',collectorNumber:'149',condition:'Near Mint',finish:'Nonfoil',
  language:'English',quantity:2,priceCents:125};
test('valid card intake remains unpublished and never authorizes writes',()=>{
 const r=previewCardInventoryDrafts([card]);
 assert.equal(r.validCount,1);assert.equal(r.errorCount,0);
 assert.equal(r.canWrite,false);assert.equal(r.canPublish,false);assert.equal(r.canCheckout,false);
 assert.equal(r.drafts[0].published,false);
});
test('duplicates, malformed quantities and prices fail closed',()=>{
 const r=previewCardInventoryDrafts([card,{...card,sku:'mtg-lb-001'},
  {...card,sku:'MTG-LB-002',quantity:1.5},
  {...card,sku:'MTG-LB-003',priceCents:0}]);
 assert.equal(r.validCount,1);assert.equal(r.errorCount,3);
 assert.deepEqual(r.errors.map(e=>e.row),[2,3,4]);
});
test('batch bounds and unsupported games rejected',()=>{
 assert.throws(()=>previewCardInventoryDrafts(new Array(251).fill(card)),/250/);
 assert.equal(previewCardInventoryDrafts([{...card,game:'Unknown'}]).errorCount,1);
});
