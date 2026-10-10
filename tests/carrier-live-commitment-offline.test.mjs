import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {composeOfflineLiveCarrierCommitment} from '../backend/carrier-live-commitment-offline.mjs';
import {parcelsForVerifiedCart} from '../backend/carrier-rating-v2.mjs';
import {shippingDestinationHmac} from '../backend/stripe-shipping-bind.mjs';
import {validateCheckoutIntent,verifyCheckoutQuote,buildReservationTransactions} from '../backend/checkout-v2-core.mjs';
import {buildIdempotentReservationPlan,verifyIdempotentReservationReplay} from '../backend/checkout-reservations-v2.mjs';

const reqId='7cf18d40-0a57-4f45-af9f-fb5d478cf5a0';
const key=Buffer.from('fake-local-test-key-for-hmac-at-least-32-bytes');
const destination={recipient:'Fixture Receiver',line1:'22 Test Lane',line2:'',
  city:'Seattle',state:'WA',postalCode:'98101',country:'US'};
const destinationTwo={...destination,line1:'55 Changed Road'};
const packing={lengthIn:8,widthIn:5,heightIn:1,weightOz:6};
const product={productId:'physical-item-1',sku:'MTG-TEST-1',productName:'Sample pack',
  salePrice:6,published:true,status:'ACTIVE',shippingPackage:packing};
const intent=validateCheckoutIntent({requestId:reqId,items:[{productId:product.productId,qty:2}]});
const products=new Map([[product.productId,product]]);
function fixture(overrides={}){
  const quote=verifyCheckoutQuote(intent,{
    productsById:products,
    stockById:new Map([[product.productId,{productId:product.productId,
      onHand:7,reserved:1,version:3}]]),
    skuCounts:new Map([['mtg-test-1',1]])
  });
  const measuredParcels=parcelsForVerifiedCart(intent,products);
  const selectedRates=[
    {productId:product.productId,unit:1,provider:'easypost',mode:'live',
      carrier:'USPS',service:'GroundAdvantage',rateId:'rate_abcdefgh123456',
      shippingCents:400,currency:'usd'},
    {productId:product.productId,unit:2,provider:'easypost',mode:'live',
      carrier:'USPS',service:'GroundAdvantage',rateId:'rate_qwertyuiop123456',
      shippingCents:500,currency:'usd'}
  ];
  return {productQuote:quote,measuredParcels,selectedRates,
    destination,destinationSigningKey:key,
    addressDeliverabilityVerified:true,
    checkedAt:'2026-10-10T02:00:00Z',
    holdUntil:'2026-10-10T02:30:00Z',
    carrierQuoteExpiresAt:'2026-10-10T03:00:00Z',...overrides};
}
const make=(overrides={})=>composeOfflineLiveCarrierCommitment(fixture(overrides));
function reserve(q){
  return buildIdempotentReservationPlan(q,{
    stockTable:'ISOLATED-STOCK',orderTable:'ISOLATED-ORDERS',
    idempotencyTable:'ISOLATED-REQUESTS',orderId:'order-123',
    now:'2026-10-10T02:00:00Z',holdUntil:'2026-10-10T02:30:00Z'
  });
}
test('one measured physical parcel per unit builds an inert HMAC-bound server quote with exact carrier total',()=>{
  const q=make();
  assert.equal(q.shippingCents,900);
  assert.equal(q.subtotalCents,1200);
  assert.equal(q.preTaxCents,2100);
  assert.equal(q.taxCents,null);
  assert.equal(q.totalCents,null);
  assert.equal(q.shippingRegion,'contiguous');
  assert.equal(q.rateMode,'live');
  assert.equal(q.rateProvider,'easypost');
  assert.equal(q.ratedParcelCount,2);
  assert.equal(q.carrierRateConfirmedForPayment,true);
  assert.deepEqual(q.carrierRateIds,['rate_abcdefgh123456','rate_qwertyuiop123456']);
  assert.deepEqual(q.carrierRateDetails,[
    {rateId:'rate_abcdefgh123456',shippingCents:400},
    {rateId:'rate_qwertyuiop123456',shippingCents:500}
  ]);
  assert.equal(q.shippingDestinationDigest,shippingDestinationHmac(destination,key));
  assert.equal(q.carrierQuoteExpiresAt,'2026-10-10T03:00:00.000Z');
  assert.equal(q.checkoutReady,false);
  assert.equal(q.paymentReady,false);
  assert.equal(q.executable,false);
  const encoded=JSON.stringify(q);
  for(const privatePart of ['22 Test Lane','98101','Fixture Receiver',
    'fake-local-test-key','sk_test_','whsec_'])
    assert.equal(encoded.includes(privatePart),false,'must not serialize raw customer/secret '+privatePart);
  const model=reserve(q);
  assert.equal(model.executable,false);
  assert.equal(model.paymentReady,false);
  assert.equal(model.order.shippingAddressVerified,true);
  assert.equal(model.order.shippingDestinationDigest,q.shippingDestinationDigest);
  assert.equal(model.order.shippingCents,900);
  assert.equal(model.order.totalCents,null);
  assert.equal(model.order.taxCents,null);
  assert.equal(model.order.rateMode,'live');
  assert.deepEqual(model.order.carrierRateIds,q.carrierRateIds);
});
test('changing the exact street keeps shipping total but changes HMAC and idempotency fingerprint',()=>{
  const a=make();
  const b=make({destination:destinationTwo});
  assert.equal(a.shippingCents,b.shippingCents);
  assert.notEqual(a.shippingDestinationDigest,b.shippingDestinationDigest);
  assert.notEqual(reserve(a).ledger.quoteHash,reserve(b).ledger.quoteHash);
  assert.throws(()=>verifyIdempotentReservationReplay(reserve(a).ledger,reserve(b)),/conflicting/);
});
test('changing the allocation of per-parcel rates invalidates the same checkout request',()=>{
  const first=fixture();
  const changed=make({selectedRates:[
    {...first.selectedRates[0],shippingCents:450},
    {...first.selectedRates[1],shippingCents:450}
  ]});
  assert.equal(changed.shippingCents,make().shippingCents);
  assert.notEqual(reserve(make()).ledger.quoteHash,reserve(changed).ledger.quoteHash);
});
test('rejects no independent address confirmation, unkeyed addresses, bad/missing HMAC keys',()=>{
  for(const overrides of [
    {addressDeliverabilityVerified:false},
    {addressDeliverabilityVerified:undefined},
    {destinationSigningKey:undefined},
    {destinationSigningKey:Buffer.from('short')},
    {destination:{...destination,country:'GB'}},
    {destination:{...destination,line1:''}},
    {destination:{...destination,postalCode:'abcde'}}
  ])assert.throws(()=>make(overrides));
});
test('rates must outlast reservation hold and be backed by a proper trusted UTC clock',()=>{
  for(const overrides of [
    {checkedAt:'invalid'},
    {checkedAt:'2026-10-10T03:15:00Z'},
    {checkedAt:'2026-10-10T02:00:00+00:00'},
    {holdUntil:'2026-10-10T02:00:00Z'},
    {carrierQuoteExpiresAt:'2026-10-10T02:30:00Z'},
    {carrierQuoteExpiresAt:'2026-10-10T02:00:00Z'},
    {carrierQuoteExpiresAt:'2026-10-10T02:59:59+00:00'}
  ])assert.throws(()=>make(overrides),/UTC|hold|valid/);
});
test('each physical unit must have exactly one matching measured parcel and one unique live rate',()=>{
  const original=fixture();
  const bad=[
    {measuredParcels:[]},
    {measuredParcels:[original.measuredParcels[0]]},
    {measuredParcels:[
      original.measuredParcels[1],original.measuredParcels[0]
    ]},
    {measuredParcels:[
      {...original.measuredParcels[0],weightOz:0},
      original.measuredParcels[1]
    ]},
    {selectedRates:[original.selectedRates[0]]},
    {selectedRates:[original.selectedRates[1],original.selectedRates[0]]},
    {selectedRates:[
      original.selectedRates[0],
      {...original.selectedRates[1],rateId:original.selectedRates[0].rateId}
    ]},
    {selectedRates:[
      original.selectedRates[0],
      {...original.selectedRates[1],mode:'test'}
    ]},
    {selectedRates:[
      {...original.selectedRates[0],provider:'unknown'},
      original.selectedRates[1]
    ]},
    {selectedRates:[
      {...original.selectedRates[0],currency:'cad'},original.selectedRates[1]
    ]},
    {selectedRates:[
      {...original.selectedRates[0],shippingCents:0},original.selectedRates[1]
    ]},
    {selectedRates:[
      {...original.selectedRates[0],shippingCents:50001},original.selectedRates[1]
    ]},
    {selectedRates:[
      {...original.selectedRates[0],service:'Bad/Service'},original.selectedRates[1]
    ]}
  ];
  for(const change of bad)assert.throws(()=>make(change));
});
test('missing/altered order authoritative quote and more than eight units fail closed',()=>{
  const original=fixture();
  for(const change of [
    {productQuote:{...original.productQuote,totalCents:0}},
    {productQuote:{...original.productQuote,taxCents:0}},
    {productQuote:{...original.productQuote,shippingCents:0}},
    {productQuote:{...original.productQuote,subtotalCents:100}},
    {productQuote:{...original.productQuote,items:[]}},
    {productQuote:{...original.productQuote,items:[
      {...original.productQuote.items[0],qty:9}
    ]}}
  ])assert.throws(()=>make(change));
});
