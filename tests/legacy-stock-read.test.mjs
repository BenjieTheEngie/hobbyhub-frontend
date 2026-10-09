import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyStockListFromDynamoRows,joinLegacyReadOnlyStock,legacyStockSummary} from '../backend/legacy-stock-read-logic.mjs';
import {fetchLegacyStockReadOnly} from '../src/lib/legacyStockReadClient.js';
const rows=[
  {productId:'ID-1',quantityOnHand:50,reorderPoint:10,updatedAt:'2026-10-09T18:00:00Z'},
  {productId:'ID-2',quantityOnHand:1,reorderPoint:5,updatedAt:'2026-10-09T18:00:00Z'}
];
const products=[
  {productId:'ID-1',sku:'MTG-001',productName:'A'},
  {productId:'ID-2',sku:'MTG-001',productName:'B'} // duplicate SKU doesn't collapse productId
];
test('admin-only legacy stock read model keeps real counts separate from future reservations',()=>{
  const verified=legacyStockListFromDynamoRows(rows);
  const joined=joinLegacyReadOnlyStock(products,verified);
  assert.deepEqual(legacyStockSummary(joined),{verified:2,unknown:0,total:51,lowStock:1,readOnly:true});
  assert.equal(joined[0].quantityOnHand,50);
  assert.equal(joined[1].quantityOnHand,1);
  assert.equal('reserved' in joined[0],false);
  assert.equal('stockVersion' in joined[0],false);
});
test('unknown balances remain unknown instead of zero',()=>{
  const result=joinLegacyReadOnlyStock(products,rows.slice(0,1));
  assert.equal(result[1].countVerified,false);
  assert.equal(result[1].quantityOnHand,null);
  assert.equal(legacyStockSummary(result).unknown,1);
});
test('malformed or duplicate stock and orphaned productId fail closed',()=>{
  for(const bad of [
    [{...rows[0],quantityOnHand:-1}],
    [{...rows[0],quantityOnHand:'50'}],
    [{...rows[0],quantityOnHand:1.2}],
    [rows[0],rows[0]],
    [{...rows[0],productId:''}]
  ])assert.throws(()=>legacyStockListFromDynamoRows(bad));
  assert.throws(()=>joinLegacyReadOnlyStock(products,[rows[0],{...rows[1],productId:'not-a-product'}]),/orphaned/);
  assert.throws(()=>joinLegacyReadOnlyStock([products[0],products[0]],rows),/duplicate productId/);
});
test('browser never POSTs or mutates stock and checks endpoint identity',async()=>{
  let called=0;
  const response=await fetchLegacyStockReadOnly('https://example.test/root','some-jwt',async(url,args)=>{
    called++;
    assert.equal(url,'https://example.test/root/ops/legacy-stock');
    assert.equal(args.method,'GET');
    assert.equal(args.cache,'no-store');
    assert.equal(args.headers.Authorization,'Bearer some-jwt');
    assert.equal('body' in args,false);
    return {ok:true,json:async()=>({source:'original-inventory',mode:'read-only',items:rows})};
  });
  assert.equal(called,1);
  assert.deepEqual(response,rows);
  await assert.rejects(()=>fetchLegacyStockReadOnly('https://example.test','jwt',async()=>({
    ok:true,json:async()=>({source:'stock-v2',mode:'read-only',items:rows})
  })),/Source identity/);
  await assert.rejects(()=>fetchLegacyStockReadOnly('','jwt'),/not connected/);
});
