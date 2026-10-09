import test from 'node:test';
import assert from 'node:assert/strict';
import {publicCartSkuRequest,verifiedCartSkuIntent} from '../backend/cart-sku-resolver-v2.mjs';
import {verifyCheckoutQuote} from '../backend/checkout-v2-core.mjs';
const requestId='7cf18d40-0a57-4f45-af9f-fb5d478cf5a0';
const source=[
 {productId:'id-physical-1',sku:'MTG-A-1',published:true,status:'ACTIVE',productName:'Card',salePrice:4},
 {productId:'id-physical-2',sku:'GAME-B-1',published:true,status:'ACTIVE',productName:'Game',salePrice:40},
];
const input={requestId,items:[{sku:'MTG-A-1',qty:2}]};
test('resolves a complete unique SKU snapshot to immutable productId without leaking seller price',()=>{
  const result=verifiedCartSkuIntent(input,source,true);
  assert.equal(result.checkoutReady,false);
  assert.equal(result.paymentAuthorized,false);
  assert.equal(result.mustReverifyPriceAndStock,true);
  assert.deepEqual(result.items,[{productId:'id-physical-1',qty:2}]);
  assert.equal('salePrice' in result.items[0],false);
  const productMap=new Map(source.map(p=>[p.productId,p]));
  const stockMap=new Map([['id-physical-1',{productId:'id-physical-1',onHand:5,reserved:1,version:2}]]);
  const skuCounts=new Map([['mtg-a-1',1],['game-b-1',1]]);
  const quote=verifyCheckoutQuote(result,{productsById:productMap,stockById:stockMap,skuCounts});
  assert.equal(quote.subtotalCents,800);
  assert.equal(quote.checkoutReady,false);
});
test('buyer-provided prices and inventory quantities never become server checkout input',()=>{
  assert.throws(()=>verifiedCartSkuIntent({...input,items:[{sku:'MTG-A-1',qty:1,salePrice:0.01}]},source,true),/only a SKU/);
  assert.throws(()=>verifiedCartSkuIntent({...input,items:[{sku:'MTG-A-1',qty:1,quantityOnHand:999}]},source,true),/only a SKU/);
  assert.deepEqual(publicCartSkuRequest([{sku:'MTG-A-1',cartQuantity:2,salePrice:0.01,quantityOnHand:999}],requestId),
    {requestId,items:[{sku:'MTG-A-1',qty:2}]});
});
test('rejects incomplete Products snapshot or a SKU shared with unpublished legacy record',()=>{
  assert.throws(()=>verifiedCartSkuIntent(input,source,false),/Complete source/);
  assert.throws(()=>verifiedCartSkuIntent(input,[
    ...source,{productId:'other-physical-id',sku:'mtg-a-1',published:false,status:'ACTIVE'}
  ],true),/missing or ambiguous/);
});
test('rejects duplicate cart lines even if capitalization differs',()=>{
  assert.throws(()=>verifiedCartSkuIntent({...input,items:[
    {sku:'MTG-A-1',qty:1},{sku:'mtg-a-1',qty:1}]},source,true),/Duplicate cart SKU/);
});
test('unpublished and archived products always remain blocked',()=>{
  for(const variant of [{published:false},{published:undefined},{status:'INACTIVE'},{isactive:false},{isActive:false}]) {
    const changed=[{...source[0],...variant},source[1]];
    assert.throws(()=>verifiedCartSkuIntent(input,changed,true),/unapproved or inactive/);
  }
});
test('rejects malformed record IDs, missing SKUs, corrupt quantity and bad UUID',()=>{
  assert.throws(()=>verifiedCartSkuIntent(input,[source[0],source[0]],true),/duplicate productId/);
  assert.throws(()=>verifiedCartSkuIntent(input,[{...source[0],productId:''},source[1]],true),/invalid\/duplicate productId/);
  assert.throws(()=>verifiedCartSkuIntent(input,[{...source[0],sku:''},source[1]],true),/invalid SKU/);
  assert.throws(()=>verifiedCartSkuIntent({...input,items:[{sku:'MTG-A-1',qty:0}]},source,true),/quantity/);
  assert.throws(()=>verifiedCartSkuIntent({...input,requestId:'bad-id'},source,true),/idempotency/);
  assert.throws(()=>publicCartSkuRequest([{sku:'MTG-A-1',cartQuantity:30}],requestId),/cannot be submitted/);
});
test('mapping remains stable across record order and case differences',()=>{
  const first=verifiedCartSkuIntent({requestId,items:[{sku:'game-b-1',qty:1}]},[...source].reverse(),true);
  assert.equal(first.items[0].productId,'id-physical-2');
});
