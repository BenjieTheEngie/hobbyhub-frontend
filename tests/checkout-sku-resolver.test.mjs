import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStorefrontSkuIntent,resolveSkuCartToProductIntent,resolvedSkuCartSummary
} from '../backend/checkout-sku-resolver.mjs';
import {verifyCheckoutQuote} from '../backend/checkout-v2-core.mjs';

const requestId='7cf18d40-0a57-4f45-af9f-fb5d478cf5a0';
const p1={productId:'p01',sku:'MTG-001',productName:'Booster',status:'ACTIVE',published:true,salePrice:5.99};
const p2={productId:'p02',sku:'GAME-001',productName:'Retro game',status:'ACTIVE',published:true,salePrice:24.00};
const shopper={requestId,items:[{sku:'mtg-001',qty:2},{sku:'GAME-001',qty:1}]};
const valid=(allProducts=[p1,p2],cart=shopper)=>resolveSkuCartToProductIntent({
  shopperRequest:cart,allProducts,productsComplete:true
});
test('storefront SKU cart resolves only against complete, server-owned Products snapshot',()=>{
  assert.deepEqual(valid(),{requestId,items:[{productId:'p01',qty:2},{productId:'p02',qty:1}]});
  assert.deepEqual(resolvedSkuCartSummary(valid()),{
    lines:2,totalUnits:3,checkoutReady:false,stockReserved:false,paymentEnabled:false
  });
  assert.throws(()=>resolveSkuCartToProductIntent({
    shopperRequest:shopper,allProducts:[p1,p2],productsComplete:false
  }),/Complete server-owned/);
});
test('SKU resolver works with the current productId-based verified checkout model',()=>{
  const intent=valid();
  const stocks=new Map([
    ['p01',{productId:'p01',onHand:7,reserved:1,version:1}],
    ['p02',{productId:'p02',onHand:1,reserved:0,version:1}]
  ]);
  const quote=verifyCheckoutQuote(intent,{
    productsById:new Map([[p1.productId,p1],[p2.productId,p2]]),
    stockById:stocks,skuCounts:new Map([['mtg-001',1],['game-001',1]])
  });
  assert.equal(quote.subtotalCents,3598);
  assert.equal(quote.checkoutReady,false);
  assert.equal(quote.totalCents,null);
  assert.deepEqual(quote.items.map(x=>x.productId),['p01','p02']);
});
test('legacy duplicate SKU is rejected even if only one matching product is published',()=>{
  const hidden={...p1,productId:'p03',sku:'mTG-001',published:false};
  assert.throws(()=>valid([p1,p2,hidden]),/ambiguous/);
  assert.throws(()=>valid([p2]),/missing or ambiguous/);
});
test('unknown, unpublished or inactive products cannot be converted to checkout IDs',()=>{
  for(const variant of [
    {...p1,published:false},
    {...p1,status:'INACTIVE'},
    {...p1,status:undefined},
    {...p1,isactive:false},
    {...p1,isActive:false}
  ])assert.throws(()=>valid([variant,p2]),/not approved/);
});
test('shopper input cannot override productId, price, carrier rates or publication',()=>{
  for(const bad of [
    {...shopper,checkoutReady:true},
    {...shopper,items:[{sku:'MTG-001',qty:1,productId:'another'}]},
    {...shopper,items:[{sku:'MTG-001',qty:1,unitPriceCents:1}]},
    {...shopper,items:[{sku:'MTG-001',qty:1,shippingCents:0}]},
    {...shopper,items:[{sku:'MTG-001',qty:1,published:true}]}
  ])assert.throws(()=>normalizeStorefrontSkuIntent(bad));
});
test('unsafe cart, bad UUID and case-insensitive duplicate SKU lines fail closed',()=>{
  for(const items of [
    [],
    [{sku:'MTG-001',qty:0}],
    [{sku:'MTG-001',qty:'2'}],
    [{sku:'MTG-001',qty:21}],
    [{sku:'MTG-001',qty:1},{sku:'mtg-001',qty:2}],
    [{sku:'bad sku!',qty:1}]
  ])assert.throws(()=>valid([p1,p2],{requestId,items}));
  assert.throws(()=>valid([p1,p2],{...shopper,requestId:'not-a-uuid'}),/idempotency/);
});
test('incomplete malformed product identities or duplicate product IDs always block lookup',()=>{
  assert.throws(()=>valid([p1,{...p2,productId:'p01'}]),/duplicate productId/);
  assert.throws(()=>valid([p1,{...p2,productId:''}]),/missing or duplicate productId/);
  assert.throws(()=>valid([p1,{...p2,sku:''}]),/invalid SKU/);
});
