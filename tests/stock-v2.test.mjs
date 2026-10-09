import test from 'node:test';
import assert from 'node:assert/strict';
import {validProductId,validRequestId,nonnegativeWhole,validateAdjustment,validateInitialization,stockBalance,verifiedStockRows,ownRecord,safePublicProduct,joinedPublicCatalog} from '../backend/stock-v2-logic.mjs';
import {normalizeStockResponse,mergeVerifiedStock,canEditStock,computeNewStock,ensureAdjustedStockAvailable,verifiedAdjustmentReply} from '../src/lib/stockV2Client.js';

const requestId='7cf18d40-0a57-4f45-af9f-fb5d478cf5a0';
test('stock validation uses exact immutable productId and idempotency UUID',()=>{
  assert.equal(validProductId('product-001'),'product-001');
  assert.throws(()=>validProductId('bad id'),/productId/);
  assert.throws(()=>validProductId(''),/productId/);
  assert.throws(()=>validRequestId('not-uuid'),/idempotency/);
  assert.equal(validRequestId(requestId),requestId);
  assert.throws(()=>nonnegativeWhole(0.8),/whole number/);
  assert.throws(()=>nonnegativeWhole(-1),/whole number/);
});
test('opening balances require explicit quantity, reorder point and initialization reason',()=>{
  assert.deepEqual(validateInitialization({onHand:0,reorderPoint:2,requestId,reason:'initial-count',note:'verified count'}),{
    onHand:0,reorderPoint:2,requestId,reason:'initial-count',note:'verified count'});
  assert.throws(()=>validateInitialization({onHand:'5',reorderPoint:0,requestId,reason:'initial-count'}),/nonnegative whole number/);
  assert.throws(()=>validateInitialization({onHand:3,reorderPoint:0,requestId,reason:'restock'}),/initial-count/);
});
test('adjustments require integer signed delta, reason, expectedVersion and idempotency key',()=>{
  assert.deepEqual(validateAdjustment({delta:-2,expectedVersion:7,requestId,reason:'cycle-count'}),{
    delta:-2,expectedVersion:7,requestId,reason:'cycle-count',note:''});
  for(const delta of [0,1.5,100001,-100001,'4'])assert.throws(
    ()=>validateAdjustment({delta,expectedVersion:1,requestId,reason:'restock'}),/delta/);
  assert.throws(()=>validateAdjustment({delta:2,expectedVersion:0,requestId,reason:'restock'}),/Expected version/);
  assert.throws(()=>validateAdjustment({delta:2,expectedVersion:1,requestId,reason:'initial-count'}),/initialization/);
  assert.throws(()=>validateAdjustment({delta:2,expectedVersion:1,requestId,reason:'restock',note:'x'.repeat(161)}),/too long/);
});
test('stock balance refuses malformed or unknown stock data',()=>{
  assert.equal(stockBalance({productId:'id-A',onHand:3,reserved:0,reorderPoint:2,version:4}).quantityOnHand,3);
  assert.equal(stockBalance({productId:'id-A',onHand:-1,reserved:0,reorderPoint:2,version:4}),null);
  assert.equal(stockBalance({productId:'id-A',onHand:0,reserved:0,reorderPoint:2,version:0}),null);
  assert.equal(stockBalance({productId:'bad id',onHand:0,reserved:0,reorderPoint:2,version:1}),null);
});
test('transaction log replay must match original mutation parameters',()=>{
  const log={requestId,productId:'id-A',operation:'adjust',delta:-1,expectedVersion:2,reason:'damage'};
  assert.equal(ownRecord(log,'id-A',{requestId,delta:-1,expectedVersion:2,reason:'damage'},'adjust'),true);
  assert.equal(ownRecord(log,'id-A',{requestId,delta:-2,expectedVersion:2,reason:'damage'},'adjust'),false);
  assert.equal(ownRecord(log,'id-B',{requestId,delta:-1,expectedVersion:2,reason:'damage'},'adjust'),false);
});
test('public catalog requires published unique SKU and an actual positive stock balance',()=>{
  const stock={productId:'pA',quantityOnHand:7,reserved:0,reorderPoint:2,version:1};
  const base={productId:'pA',sku:'MTG-42',productName:'Play Booster',published:true,salePrice:5.99,category:'Magic: The Gathering'};
  assert.equal(safePublicProduct(base,stock).quantityOnHand,7);
  assert.equal(safePublicProduct({...base,published:false},stock),null);
  assert.equal(safePublicProduct({...base,published:undefined},stock),null);
  assert.equal(safePublicProduct(base,{...stock,quantityOnHand:0}),null);
  assert.equal(safePublicProduct({...base,salePrice:-1},stock),null);
  assert.equal(safePublicProduct({...base,productId:'another'},stock),null);
  const pub=safePublicProduct({...base,imageUrl:'javascript:alert(1)'},stock);
  assert.equal(pub.imageUrl,'');
  assert.equal('productId' in pub,false);
});
test('duplicate legacy SKU groups are never made public by accident',()=>{
  const products=[
    {productId:'a',sku:'MTG-001',productName:'A',published:true,salePrice:6},
    {productId:'b',sku:'mtg-001',productName:'B',published:true,salePrice:7},
    {productId:'c',sku:'PKM-001',productName:'C',published:true,salePrice:9},
    {productId:'d',sku:'YGO-001',productName:'D',salePrice:5}
  ];
  const balances=['a','b','c','d'].map(productId=>({productId,quantityOnHand:4,reserved:0,reorderPoint:1,version:1}));
  const items=joinedPublicCatalog(products,balances);
  assert.deepEqual(items.map(x=>x.sku),['PKM-001']);
});
test('browser stock adapter joins by productId, never ambiguous SKU',()=>{
  const snap=normalizeStockResponse({items:[
    {productId:'p1',quantityOnHand:7,reserved:0,quantityAvailable:7,reorderPoint:2,version:3},
    {productId:'p2',quantityOnHand:0,reserved:0,quantityAvailable:0,reorderPoint:1,version:1}
  ]});
  const products=[{productId:'p1',sku:'MTG-001',stockReported:false},
    {productId:'p2',sku:'MTG-001',stockReported:false},
    {productId:'p3',sku:'MTG-001',stockReported:false}];
  const rows=mergeVerifiedStock(products,snap);
  assert.deepEqual(rows.map(x=>[x.quantityOnHand,x.stockReported,x.stockVersion]),[[7,true,3],[0,true,1],[null,false,null]]);
  assert.equal(canEditStock(rows[0],'ready'),true);
  assert.equal(canEditStock(rows[2],'ready'),false);
  assert.equal(canEditStock(rows[0],'unavailable'),false);
});
test('reject malformed stock snapshot, invalid counts and duplicate product identities',()=>{
  assert.throws(()=>normalizeStockResponse({items:[{productId:'p1',quantityOnHand:-1,reserved:0,quantityAvailable:-1,reorderPoint:0,version:1}]}),/invalid/);
  assert.throws(()=>normalizeStockResponse({items:[{productId:'p1',quantityOnHand:1,reserved:0,quantityAvailable:1,reorderPoint:0,version:1},{productId:'p1',quantityOnHand:2,reserved:0,quantityAvailable:2,reorderPoint:0,version:1}]}),/duplicate/);
  assert.deepEqual([...normalizeStockResponse({items:[]}).entries()],[]);
});
test('stock adjustment UI uses safe arithmetic and exact server acknowledgment',()=>{
  assert.equal(computeNewStock(4,-4),0);
  assert.equal(computeNewStock(4,2),6);
  assert.throws(()=>computeNewStock(4,-5),/negative/);
  assert.throws(()=>computeNewStock(4,0),/limits/);
  assert.equal(verifiedAdjustmentReply({applied:true,adjustment:{requestId,afterOnHand:6}},requestId,6),true);
  assert.equal(verifiedAdjustmentReply({applied:true,adjustment:{requestId,afterOnHand:5}},requestId,6),false);
});

test('reserved inventory is mandatory and cannot exceed physical stock',()=>{
  assert.equal(stockBalance({productId:'idA',onHand:7,reorderPoint:2,version:1}),null);
  assert.equal(stockBalance({productId:'idA',onHand:7,reserved:8,reorderPoint:2,version:1}),null);
  assert.equal(stockBalance({productId:'idA',onHand:7,reserved:-1,reorderPoint:2,version:1}),null);
  const row=stockBalance({productId:'idA',onHand:7,reserved:3,reorderPoint:2,version:1});
  assert.equal(row.reserved,3);
  assert.equal(row.quantityAvailable,4);
});
test('public catalog displays only unreserved units and hides fully reserved items',()=>{
  const item={productId:'idA',sku:'CARDS-001',productName:'Card',published:true,salePrice:5};
  const available={productId:'idA',quantityOnHand:10,reserved:8};
  assert.equal(safePublicProduct(item,available).quantityOnHand,2);
  assert.equal(safePublicProduct(item,{...available,reserved:10}),null);
  assert.equal(safePublicProduct(item,{...available,reserved:11}),null);
  assert.equal(safePublicProduct(item,{...available,reserved:undefined}),null);
});
test('stock browser honors reserved units and rejects malformed readback',()=>{
  const snap=normalizeStockResponse({items:[{productId:'idA',quantityOnHand:10,reserved:6,quantityAvailable:4,reorderPoint:2,version:3}]});
  assert.equal(snap.get('idA').stockAvailable,4);
  assert.equal(snap.get('idA').stockReserved,6);
  const product={productId:'idA',quantityOnHand:10,stockReserved:6};
  assert.equal(ensureAdjustedStockAvailable(product,-4),6);
  assert.throws(()=>ensureAdjustedStockAvailable(product,-5),/reserved/);
  for(const row of [
    {productId:'idA',quantityOnHand:10,quantityAvailable:10,reorderPoint:2,version:3},
    {productId:'idA',quantityOnHand:10,reserved:11,quantityAvailable:-1,reorderPoint:2,version:3},
    {productId:'idA',quantityOnHand:10,reserved:4,quantityAvailable:10,reorderPoint:2,version:3}
  ])assert.throws(()=>normalizeStockResponse({items:[row]}),/invalid/);
});

test('backend stock snapshots fail closed instead of silently dropping malformed rows',()=>{
  const first={productId:'id-one',onHand:8,reserved:3,reorderPoint:2,version:1,updatedAt:'2026-10-09T18:00:00Z'};
  const second={productId:'id-two',onHand:2,reserved:0,reorderPoint:1,version:2,updatedAt:'2026-10-09T18:00:00Z'};
  const rows=verifiedStockRows([first,second]);
  assert.deepEqual(rows.map(x=>x.quantityAvailable),[5,2]);
  assert.throws(()=>verifiedStockRows([first,{...second,reserved:undefined}]),/invalid/);
  assert.throws(()=>verifiedStockRows([first,{...second,reserved:3}]),/invalid/);
  assert.throws(()=>verifiedStockRows([first,first]),/duplicate/);
  assert.throws(()=>verifiedStockRows(null),/complete list/);
  assert.deepEqual(verifiedStockRows([]),[]);
});

test('published catalog refuses inactive legacy statuses and non-cent prices',()=>{
  const base={productId:'ID-01',sku:'MTG-01',productName:'Sealed Pack',published:true,
    status:'ACTIVE',salePrice:4.99};
  const stock={productId:'ID-01',quantityOnHand:5,reserved:1};
  assert.equal(safePublicProduct(base,stock).quantityOnHand,4);
  assert.equal(safePublicProduct({...base,status:'INACTIVE'},stock),null);
  assert.equal(safePublicProduct({...base,status:'DISCONTINUED'},stock),null);
  assert.equal(safePublicProduct({...base,salePrice:4.999},stock),null);
  assert.equal(safePublicProduct({...base,salePrice:50001},stock),null);
  assert.equal(safePublicProduct({...base,salePrice:5.25},stock).salePrice,5.25);
});

test('a missing Stock V2 record is not an invented zero balance',()=>{
  const snap=normalizeStockResponse({items:[]});
  const product={productId:'needs-review',sku:'ABC',quantityOnHand:40,stockReported:true};
  const joined=mergeVerifiedStock([product],snap);
  assert.equal(joined[0].quantityOnHand,null);
  assert.equal(joined[0].stockAvailable,null);
  assert.equal(joined[0].stockReserved,null);
  assert.equal(joined[0].stockReported,false);
});
