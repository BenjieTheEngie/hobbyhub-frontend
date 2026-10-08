import test from 'node:test';
import assert from 'node:assert/strict';
import {isArchived,normalizeInventoryResponse,inventoryForView,archiveConfirmed} from '../src/lib/inventoryStatus.js';

test('soft archived records are not active',()=>{
  assert.equal(isArchived({isactive:false}),true);
  assert.equal(isArchived({isActive:false}),true);
  assert.equal(isArchived({isactive:true}),false);
});
test('normalizes archived and active API products without discarding archives',()=>{
  const inventory=normalizeInventoryResponse({items:[
    {sku:'MTG-001',name:'Magic booster',isactive:true,published:true,quantityOnHand:4},
    {sku:'PKM-002',productName:'Archived box',isActive:false,published:false,quantityOnHand:2},
  ]});
  assert.equal(inventory.length,2);
  assert.equal(inventory[0].productName,'Magic booster');
  assert.equal(inventory[1].isactive,false);
  assert.equal(inventory[0].isactive,true);
  assert.equal(inventoryForView(inventory).length,1);
  assert.equal(inventoryForView(inventory,true)[0].sku,'PKM-002');
});
test('rejects malformed inventory payloads instead of assuming empty list',()=>{
  assert.throws(()=>normalizeInventoryResponse({message:'Backend not configured'}),/invalid products list/);
});
test('recognizes confirmed soft archive acknowledgments',()=>{
  assert.equal(archiveConfirmed({archived:'MTG-001'},'MTG-001'),true);
  assert.equal(archiveConfirmed({archived:'MTG-002'},'MTG-001'),false);
});
test('does not pretend an unconfirmed SKU removal worked',()=>{
  assert.equal(archiveConfirmed({},'MTG-001',[{sku:'MTG-001',isactive:true}]),false);
});
test('accepts a verified archived record or fully removed SKU after refresh',()=>{
  assert.equal(archiveConfirmed({},'MTG-001',[{sku:'MTG-001',isactive:false}]),true);
  assert.equal(archiveConfirmed({},'MTG-001',[{sku:'MTG-002',isactive:true}]),true);
});
test('empty payload is a valid inventory list',()=>{
  assert.deepEqual(normalizeInventoryResponse({items:[]}),[]);
  assert.deepEqual(inventoryForView([],true),[]);
});
