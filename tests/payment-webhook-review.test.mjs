import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedWebhookEventFingerprint,reviewSignedTestPaymentEvent} from '../backend/payment-webhook-review.mjs';
const base={
  eventId:'evt_abcdefghijk1234',type:'checkout.session.completed',
  mode:'test',sessionId:'cs_test_abc12345678',orderId:'order-01',
  paymentStatus:'paid',amountTotalCents:1399,currency:'usd'
};
const order={
  orderId:'order-01',stripeSessionId:'cs_test_abc12345678',paymentMode:'test',
  version:3,status:'RESERVED',paymentStatus:'PENDING',fulfillmentStatus:'UNFULFILLED',
  subtotalCents:1000,shippingCents:299,taxCents:100,totalCents:1399,currency:'usd',
  shippingCountry:'US',shippingMethod:'domestic_shipping',pickupAvailable:false,
  reservedUntil:'2026-10-09T19:00:00Z',items:[{productId:'physical-id',qty:1}]
};
const trust={signatureVerified:true,verifiedBy:'stripe-sdk-raw-body'};
const at='2026-10-09T18:30:00Z';
const review=(e=base,o=order,overrides={})=>
  reviewSignedTestPaymentEvent({event:e,order:o,trust,receivedAt:at,previousEvents:new Map(),...overrides});
test('valid signed paid event requests reconciliation, never marks paid or reduces stock directly',()=>{
  const decision=review();
  assert.equal(decision.disposition,'RECONCILE_PAID_AND_STOCK_ATOMICALLY');
  assert.equal(decision.paymentWriteAuthorized,false);
  assert.equal(decision.checkoutEnabled,false);
  assert.equal(decision.fulfillmentAuthorized,false);
  assert.equal(decision.stockReservationAction,'NONE');
  assert.equal(decision.requiresTransactionalStockReconciliation,true);
  assert.equal(decision.expectedOrderVersion,3);
  assert.match(decision.fingerprint,/^[a-f0-9]{64}$/);
});
test('webhook reviewing requires a real Stripe SDK signature-verification boundary',()=>{
  for(const invalid of [undefined,{}, {signatureVerified:true},{signatureVerified:false,verifiedBy:'stripe-sdk-raw-body'}])
    assert.throws(()=>review(base,order,{trust:invalid}),/raw-body signature/);
});
test('test mode, original session and immutable orderId must match',()=>{
  const invalid=[
    {...base,mode:'live'},
    {...base,sessionId:'cs_live_abc12345678'},
    {...base,orderId:'order-02'},
    {...base,currency:'eur'},
    {...base,amountTotalCents:1.5}
  ];
  for(const event of invalid)assert.throws(()=>review(event));
  assert.throws(()=>review(base,{...order,stripeSessionId:'cs_test_othervalue12345'}),/server-stored/);
  assert.throws(()=>review(base,{...order,paymentMode:'live'}),/server-stored/);
});
test('does not infer a charge from completed-but-unpaid checkout redirect',()=>{
  const result=review({...base,paymentStatus:'unpaid'});
  assert.equal(result.disposition,'WAIT_FOR_VERIFIED_PAYMENT');
  assert.equal(result.fulfillmentAuthorized,false);
  assert.equal(result.stockReservationAction,'NONE');
});
test('async paid confirms need for a trusted paid reconciliation; failure/expiry need release review',()=>{
  assert.equal(review({...base,type:'checkout.session.async_payment_succeeded'}).disposition,'RECONCILE_PAID_AND_STOCK_ATOMICALLY');
  assert.equal(review({...base,type:'checkout.session.async_payment_failed',paymentStatus:'unpaid'}).disposition,'REVIEW_RELEASE_WITH_LATE_PAYMENT_SAFEGUARDS');
  assert.equal(review({...base,type:'checkout.session.expired',paymentStatus:'unpaid'}).disposition,'REVIEW_RELEASE_WITH_LATE_PAYMENT_SAFEGUARDS');
});
test('late paid event never blindly captures stock or refunds',()=>{
  assert.equal(review(base,order,{receivedAt:'2026-10-09T19:01:00Z'}).disposition,'REVIEW_LATE_PAYMENT_AND_REFUND_POLICY');
});
test('mismatched totals, unsigned tax, missing items and international/pickup orders are rejected',()=>{
  const altered=[
    {...order,totalCents:1299},{...order,taxCents:null},
    {...order,shippingCents:null},{...order,currency:'cad'},
    {...order,items:[]},{...order,shippingCountry:'CA'},
    {...order,pickupAvailable:true},{...order,status:'PAID',paymentStatus:'PAID'},
    {...order,version:0},{...order,reservedUntil:null}
  ];
  for(const x of altered)assert.throws(()=>review(base,x));
  assert.throws(()=>review({...base,amountTotalCents:999}),/total/);
});
test('duplicate provider events are ignored only when durable fingerprint matches',()=>{
  const fingerprint=verifiedWebhookEventFingerprint(base);
  const previousEvents=new Map([[base.eventId,{fingerprint}]]);
  const replay=review(base,order,{previousEvents});
  assert.equal(replay.disposition,'ALREADY_REVIEWED');
  assert.equal(replay.paymentWriteAuthorized,false);
  assert.equal(previousEvents.size,1);
  assert.throws(()=>review({...base,amountTotalCents:1200},order,{previousEvents}),/collision/);
});
test('unknown event types and arbitrary client-authored events fail closed',()=>{
  for(const event of [{...base,type:'charge.succeeded'},
    {...base,eventId:'not-event'},{...base,paymentStatus:'unknown'}])
    assert.throws(()=>verifiedWebhookEventFingerprint(event));
  assert.throws(()=>review(base,order,{previousEvents:undefined}),/Durable provider-event replay/);
  assert.throws(()=>review(base,order,{receivedAt:'tomorrow'}),/timestamp/);
});
