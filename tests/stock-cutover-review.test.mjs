import test from 'node:test';
import assert from 'node:assert/strict';
import {makeStockCutoverReview,assertStockCutoverStillCurrent,safeCutoverSummary} from '../backend/stock-cutover-review.mjs';

const products=[
  {productId:'id-alpha',sku:'MTG-001',productName:'First card',status:'ACTIVE',salePrice:5},
  {productId:'id-beta',sku:'GAME-01',productName:'Retro game',status:'ACTIVE',salePrice:40}
];
const inventory=[
  {productId:'id-beta',quantityOnHand:1,reorderPoint:5,updatedAt:'2026-10-09T18:00:00Z'},
  {productId:'id-alpha',quantityOnHand:50,reorderPoint:10,updatedAt:'2026-10-09T18:00:00Z'}
];
const full=(p=products,i=inventory)=>({products:p,inventory:i,productsComplete:true,inventoryComplete:true});
test('builds only an unauthorized, unpublishable migration review with exact source quantities',()=>{
  const plan=makeStockCutoverReview(full());
  assert.equal(plan.kind,'stock-v2-review-only');
  assert.equal(plan.productCount,2);
  assert.equal(plan.inventoryCount,2);
  assert.equal(plan.quantityTotal,51);
  assert.equal(plan.authorizedForWrites,false);
  assert.equal(plan.approvedForLiveCutover,false);
  assert.match(plan.sourceFingerprint,/^[0-9a-f]{64}$/);
  assert.deepEqual(plan.rows[0].proposedOpening,{
    productId:'id-alpha',onHand:50,reserved:0,reorderPoint:10,version:1,published:false
  });
  assert.equal(plan.rows[0].sku,'MTG-001');
  assert.equal(assertStockCutoverStillCurrent(plan,full()).unchanged,true);
  const summary=safeCutoverSummary(plan);
  assert.equal('rows' in summary,false);
  assert.equal('productId' in summary,false);
  assert.equal(summary.approvedForWrites,false);
});
test('input order is irrelevant to a stable fingerprint',()=>{
  const a=makeStockCutoverReview(full());
  const b=makeStockCutoverReview(full([...products].reverse(),[...inventory].reverse()));
  assert.equal(a.sourceFingerprint,b.sourceFingerprint);
});
test('rejects incomplete scans, missing records, duplicate productIds and duplicate SKUs',()=>{
  assert.throws(()=>makeStockCutoverReview({...full(),inventoryComplete:false}),/partial scans/);
  assert.throws(()=>makeStockCutoverReview(full(products,inventory.slice(0,1))),/row counts differ/);
  assert.throws(()=>makeStockCutoverReview(full([products[0],products[0]],inventory)),/duplicate productId/);
  assert.throws(()=>makeStockCutoverReview(full(
    [products[0],{...products[1],sku:'mtg-001'}],inventory)),/Duplicate SKUs/);
  assert.throws(()=>makeStockCutoverReview(full(products,[
    {...inventory[0],productId:'not-present'},inventory[1]])),/missing its Inventory/);
});
test('rejects unsafe quantities, unrecognized statuses, missing timestamps and missing names',()=>{
  for(const quantityOnHand of [-1,'50',1.2,NaN,Infinity])assert.throws(()=>
    makeStockCutoverReview(full(products,[inventory[0],{...inventory[1],quantityOnHand}])),
    /nonnegative whole number/);
  assert.throws(()=>makeStockCutoverReview(full(
    [{...products[0],status:'INACTIVE'},products[1]],inventory)),/ACTIVE/);
  assert.throws(()=>makeStockCutoverReview(full(products,[
    {...inventory[0],updatedAt:undefined},inventory[1]])),/updatedAt/);
  assert.throws(()=>makeStockCutoverReview(full(
    [{...products[0],productName:''},products[1]],inventory)),/Product name missing/);
});
test('changing one stock quantity, reorder point, SKU, publication or price invalidates old review',()=>{
  const a=makeStockCutoverReview(full());
  const variations=[
    full(products,[inventory[0],{...inventory[1],quantityOnHand:49}]),
    full(products,[{...inventory[0],reorderPoint:6},inventory[1]]),
    full([{...products[0],sku:'MTG-002'},products[1]],inventory),
    full([{...products[0],published:true},products[1]],inventory),
    full([{...products[0],salePrice:6},products[1]],inventory),
  ];
  for(const next of variations)assert.throws(()=>
    assertStockCutoverStillCurrent(a,next),/Legacy stock changed/);
});
test('review never enables payment, stock writes or publication',()=>{
  const plan=makeStockCutoverReview(full());
  assert.equal(plan.rows.every(x=>x.proposedOpening.reserved===0&&x.proposedOpening.published===false),true);
  assert.equal(plan.rows.every(x=>!('approvedForMigration' in x)),true);
  assert.throws(()=>safeCutoverSummary({...plan,authorizedForWrites:true}),/trustworthy/);
});
