import test from 'node:test';
import assert from 'node:assert/strict';
import {productIdentity,productRoute,countSkuMatches,recordChangedOrRemoved,exactLegacyDeletionConfirmed,safeRecordLabel} from '../src/lib/legacyInventory.js';
import {normalizeInventoryResponse} from '../src/lib/inventoryStatus.js';

const duplicates=[
  {sku:'MTG-001',productId:'record-001',productName:'Magic Booster Pack',salePrice:5.99,category:'Magic'},
  {sku:'MTG-001',productId:'record-002',productName:'Magic Booster Pack',salePrice:-1,category:'Magic'},
];

test('legacy API route uses productId instead of duplicated SKU',()=>{
  assert.deepEqual(productIdentity(duplicates[0],true),{field:'productId',id:'record-001'});
  assert.equal(productRoute(duplicates[0],true),'/products/record-001');
  assert.equal(productRoute(duplicates[0],false),'/products/MTG-001');
  assert.equal(productRoute({sku:'MTG-001'},true),null);
  assert.equal(countSkuMatches(duplicates,'MTG-001'),2);
});
test('legacy deletion verification checks exact record ID and rejects fake success',()=>{
  assert.equal(recordChangedOrRemoved(duplicates[0],duplicates,true),false);
  assert.equal(recordChangedOrRemoved(duplicates[0],[duplicates[1]],true),true);
  assert.equal(recordChangedOrRemoved(duplicates[0],[],true),true);
  assert.equal(recordChangedOrRemoved(duplicates[0],[{sku:'MTG-001'}],true),false);
  assert.equal(recordChangedOrRemoved({sku:'MTG-001'},[],true),false);
  assert.equal(recordChangedOrRemoved(duplicates[0],null,true),false);
});
test('archive confirmation needs a truly archived exact SKU',()=>{
  const product={sku:'MTG-001'};
  assert.equal(recordChangedOrRemoved(product,[{sku:'MTG-001',isactive:true}],false,true),false);
  assert.equal(recordChangedOrRemoved(product,[{sku:'MTG-001',isactive:false}],false,true),true);
  assert.equal(recordChangedOrRemoved(product,[{sku:'MTG-001',isactive:false}],false,false),false);
});
test('legacy stock absence remains explicitly unknown rather than zero',()=>{
  const rows=normalizeInventoryResponse({items:duplicates});
  assert.equal(rows.length,2);
  assert.equal(rows[0].stockReported,false);
  assert.equal(rows[1].stockReported,false);
  assert.equal(rows[0].quantityOnHand,0);
  assert.equal(rows[1].priceInvalid,true);
  assert.equal(rows[1].salePrice,0); // normalized safety display only, original remains in AWS
});
test('existing real stock is flagged as reported and productId is preserved',()=>{
  const result=normalizeInventoryResponse({items:[{...duplicates[0],quantityOnHand:3}]});
  assert.equal(result[0].stockReported,true);
  assert.equal(result[0].productId,'record-001');
  assert.equal(safeRecordLabel(result[0]),'…rd-001');
});

test('exact deletion verification confirms one targeted legacy productId and keeps nine duplicates',()=>{
  const before=Array.from({length:10},(_,i)=>({productId:'id-'+i,sku:'MTG-001'}));
  const after=before.filter(x=>x.productId!=='id-7');
  assert.equal(exactLegacyDeletionConfirmed(before[7],before,after),true);
  assert.equal(after.filter(x=>x.sku==='MTG-001').length,9);
});
test('exact deletion verification rejects stale results, empty list and deleting the wrong ID',()=>{
  const before=[{productId:'id-A',sku:'MTG-001'},{productId:'id-B',sku:'MTG-001'}];
  assert.equal(exactLegacyDeletionConfirmed(before[0],before,before),false);
  assert.equal(exactLegacyDeletionConfirmed(before[0],before,[before[0]]),false);
  assert.equal(exactLegacyDeletionConfirmed(before[0],before,[]),false);
  assert.equal(exactLegacyDeletionConfirmed(before[0],before,[{sku:'MTG-001'}]),false);
});
test('exact deletion verification refuses unexpected bulk loss or changed product identities',()=>{
  const before=[
    {productId:'id-A',sku:'MTG-001'},
    {productId:'id-B',sku:'MTG-001'},
    {productId:'id-C',sku:'MTG-001'}
  ];
  assert.equal(exactLegacyDeletionConfirmed(before[0],before,[before[2]]),false);
  assert.equal(exactLegacyDeletionConfirmed(before[0],before,[before[1],{productId:'new-D',sku:'MTG-001'}]),false);
  assert.equal(exactLegacyDeletionConfirmed(before[0],before,[before[1],before[1]]),false);
  assert.equal(exactLegacyDeletionConfirmed(before[0],[before[0],before[0]],[before[0]]),false);
  assert.equal(exactLegacyDeletionConfirmed({sku:'MTG-001'},before,[before[1],before[2]]),false);
});
