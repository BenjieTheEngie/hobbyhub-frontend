import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCheckoutIntent,priceCentsFromStoredDollars,verifyCheckoutQuote,buildReservationTransactions,fulfillmentEligible} from '../backend/checkout-v2-core.mjs';
import {quoteDomesticShipping,composePrecheckoutTotals} from '../backend/shipping-v2.mjs';

const requestId='7cf18d40-0a57-4f45-af9f-fb5d478cf5a0';
const inventory=[
  {productId:'product-01',sku:'MTG-SET-001',productName:'Magic sealed booster',published:true,isactive:true,salePrice:5.99},
  {productId:'product-02',sku:'PKM-BOX-001',productName:'Pokemon trainer box',published:true,isactive:true,salePrice:44},
  {productId:'product-03',sku:'MTG-SET-001',productName:'Duplicate legacy booster',published:false,salePrice:6},
];
const stock=[
  {productId:'product-01',onHand:9,reserved:2,version:5},
  {productId:'product-02',onHand:1,reserved:0,version:2},
];
const request={requestId,items:[{productId:'product-01',qty:2},{productId:'product-02',qty:1}]};
const shippingAddress={recipient:'Test Customer',line1:'123 Test Street',city:'Boston',state:'MA',postalCode:'02110',country:'US'};
const fakeApprovedTestRates={method:'domestic_shipping',country:'US',pickupEnabled:false,approved:true,
  ratesCents:{contiguous:850,alaska:2500,hawaii:2600}};
function shippingEstimate(quote){return composePrecheckoutTotals(quote,quoteDomesticShipping(shippingAddress,fakeApprovedTestRates));}
function snapshots({allowDuplicates=false}={}) {
  return {
    productsById:new Map(inventory.map(p=>[p.productId,p])),
    stockById:new Map(stock.map(s=>[s.productId,s])),
    skuCounts:new Map([['mtg-set-001',allowDuplicates?1:2],['pkm-box-001',1]]),
  };
}
test('checkout intent cannot carry fake prices, duplicate IDs or invalid quantities',()=>{
  assert.deepEqual(validateCheckoutIntent(request),request);
  assert.throws(()=>validateCheckoutIntent({...request,requestId:'not-a-uuid'}),/idempotency/);
  assert.throws(()=>validateCheckoutIntent({...request,items:[]}),/1 and 20/);
  assert.throws(()=>validateCheckoutIntent({...request,items:[request.items[0],request.items[0]]}),/duplicate product IDs/);
  assert.throws(()=>validateCheckoutIntent({...request,items:[{productId:'product-01',qty:3,priceCents:1}]}),/server-authoritative/);
  assert.throws(()=>validateCheckoutIntent({...request,items:[{productId:'product-01',qty:0}]}),/between 1 and 20/);
});
test('price conversion enforces integer cents and rejects misleading money precision',()=>{
  assert.equal(priceCentsFromStoredDollars(5.99),599);
  assert.equal(priceCentsFromStoredDollars(44),4400);
  for(const x of [0,-1,'5.99',5.999,NaN,100000])assert.throws(()=>priceCentsFromStoredDollars(x),/price/);
});
test('complete unique SKU inventory view is mandatory',()=>{
  const intent=validateCheckoutIntent(request);
  assert.throws(()=>verifyCheckoutQuote(intent,snapshots()),/duplicate or ambiguous SKU/);
  const quote=verifyCheckoutQuote(intent,snapshots({allowDuplicates:true}));
  assert.equal(quote.subtotalCents,5598);
  assert.equal(quote.currency,'usd');
  assert.equal(quote.totalCents,null);
  assert.equal(quote.checkoutReady,false);
  assert.equal(quote.items[0].stockReserved,2);
});
test('unpublished, missing, insufficient or uninitialized stock always blocks reservation',()=>{
  const intent=validateCheckoutIntent(request);
  const q=snapshots({allowDuplicates:true});
  q.stockById.set('product-02',{productId:'product-02',onHand:1,version:1});
  assert.throws(()=>verifyCheckoutQuote(intent,q),/not configured/);
  q.stockById.set('product-02',{productId:'product-02',onHand:1,reserved:1,version:1});
  assert.throws(()=>verifyCheckoutQuote(intent,q),/Insufficient/);
  q.stockById.set('product-02',stock[1]);
  q.productsById.set('product-01',{...inventory[0],published:false});
  assert.throws(()=>verifyCheckoutQuote(intent,q),/unavailable or unpublished/);
});
test('reservation plan atomically updates exact productId/version/reserved and saves immutable order data',()=>{
  const quote=shippingEstimate(verifyCheckoutQuote(validateCheckoutIntent(request),snapshots({allowDuplicates:true})));
  const result=buildReservationTransactions(quote,{
    stockTable:'TEST-STOCK',orderTable:'TEST-ORDERS',orderId:'order-123',
    now:'2026-10-09T10:00:00Z',holdUntil:'2026-10-09T10:35:00Z'
  });
  assert.equal(result.transactItems.length,3);
  assert.deepEqual(result.transactItems[0].Update.Key,{productId:'product-01'});
  assert.equal(result.transactItems[0].Update.ExpressionAttributeValues[':reserved'],2);
  assert.equal(result.transactItems[0].Update.ExpressionAttributeValues[':qty'],2);
  assert.match(result.transactItems[0].Update.ConditionExpression,/#version = :expected/);
  assert.match(result.transactItems[0].Update.ConditionExpression,/#onHand = :onHand/);
  assert.equal(result.order.paymentStatus,'PENDING');
  assert.equal(result.order.fulfillmentStatus,'UNFULFILLED');
  assert.equal(result.order.totalCents,null);
  assert.equal(result.order.subtotalCents,5598);
  assert.equal(result.order.shippingCents,850); // test fixture, not a live shipping price
  assert.equal(result.order.shippingMethod,'domestic_shipping');
  assert.equal(result.order.shippingCountry,'US');
  assert.equal(result.order.shippingAddressVerified,false);
  assert.equal('customerEmail' in result.order,false);
  assert.equal('stripeSessionId' in result.order,false);
});
test('reservation expiry and unknown order details refuse transaction building',()=>{
  const quote=shippingEstimate(verifyCheckoutQuote(validateCheckoutIntent(request),snapshots({allowDuplicates:true})));
  assert.throws(()=>buildReservationTransactions(quote,{stockTable:'S',orderTable:'O',orderId:'order-3',now:'2026-10-09T10:00:00Z',holdUntil:'2026-10-09T09:00:00Z'}),/expiry/);
  assert.throws(()=>buildReservationTransactions(quote,{stockTable:'S',orderTable:'O',orderId:'bad id',now:'2026-10-09T10:00:00Z',holdUntil:'2026-10-09T10:35:00Z'}),/identity/);
});
test('never infer fulfillment permission from Stripe return URL or cart status',()=>{
  const order={status:'RESERVED',paymentStatus:'PENDING',fulfillmentStatus:'UNFULFILLED',shippingCountry:'US',shippingMethod:'domestic_shipping',shippingAddressVerified:false,pickupAvailable:false,items:[{qty:1}]};
  assert.equal(fulfillmentEligible(order),false);
  assert.equal(fulfillmentEligible({...order,paymentStatus:'PAID'}),false);
  assert.equal(fulfillmentEligible({...order,paymentStatus:'PAID',status:'PAID'}),false);
  assert.equal(fulfillmentEligible({...order,paymentStatus:'PAID',status:'PAID',shippingAddressVerified:true}),true);
  assert.equal(fulfillmentEligible({...order,paymentStatus:'PAID',status:'PAID',shippingAddressVerified:true,items:[]}),false);
  assert.equal(fulfillmentEligible({...order,paymentStatus:'PAID',status:'PAID',shippingAddressVerified:true,shippingCountry:'CA'}),false);
});
