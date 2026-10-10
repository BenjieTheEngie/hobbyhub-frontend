import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {reviewStripeTestCheckoutReconciliation} from '../backend/stripe-v2-reconciliation.mjs';
import {shippingDestinationHmac} from '../backend/stripe-shipping-bind.mjs';
import {verifiedWebhookEventFingerprint} from '../backend/payment-webhook-review.mjs';

const webhookSecret='whsec_offline-only-webhook-secret-not-real';
const shippingKey=Buffer.from('offline-only-merchant-address-key-not-an-aws-secret');
const at='2026-10-09T20:00:00Z';
const unix=Date.parse(at)/1000;
const address={
  country:'US',state:'MA',postal_code:'02382',city:'Whitman',
  line1:'123 Test Street',line2:''
};
const order={
  orderId:'order-123',stripeSessionId:'cs_test_abcdefgh123456',
  paymentMode:'test',version:2,status:'RESERVED',paymentStatus:'PENDING',
  fulfillmentStatus:'UNFULFILLED',currency:'usd',shippingCountry:'US',
  shippingMethod:'domestic_shipping',pickupAvailable:false,
  shippingState:'MA',shippingAddressVerified:true,
  shippingDestinationDigest:shippingDestinationHmac(address,shippingKey),
  carrierQuoteExpiresAt:'2026-10-09T20:30:00Z',
  reservedUntil:'2026-10-09T20:25:00Z',
  subtotalCents:1200,shippingCents:599,taxCents:99,totalCents:1898,
  items:[{productId:'card-01',qty:2,unitPriceCents:600,lineTotalCents:1200}]
};
const session={
  object:'checkout.session',id:order.stripeSessionId,livemode:false,
  mode:'payment',client_reference_id:order.orderId,metadata:{orderId:order.orderId},
  currency:'usd',amount_subtotal:1200,shipping_cost:{amount_total:599},
  total_details:{amount_tax:99,amount_discount:0},amount_total:1898,
  automatic_tax:{enabled:true,status:'complete'},
  status:'complete',payment_status:'paid',payment_intent:'pi_abcdefgh123456',
  collected_information:{shipping_details:{address}}
};
const event={
  id:'evt_abcdefgh123456',livemode:false,type:'checkout.session.completed',
  data:{object:session}
};
function sign(providerEvent=event){
  const body=JSON.stringify(providerEvent);
  const digest=createHmac('sha256',webhookSecret).update(unix+'.'+body).digest('hex');
  return {httpMethod:'POST',body,isBase64Encoded:false,
    headers:{'Stripe-Signature':'t='+unix+',v1='+digest}};
}
const sdk={webhooks:{constructEvent(raw,header,key,tolerance){
  assert.equal(key,webhookSecret);
  assert.equal(tolerance,300);
  const match=/^t=(\d+),v1=([a-f0-9]{64})$/.exec(header);
  if(!match||Number(match[1])!==unix)throw Error('Invalid timestamp');
  const expected=createHmac('sha256',key).update(match[1]+'.').update(raw).digest();
  if(!timingSafeEqual(expected,Buffer.from(match[2],'hex')))throw Error('Signature mismatch');
  return JSON.parse(raw.toString('utf8'));
}}};
function audit(overrides={}){
  return reviewStripeTestCheckoutReconciliation({
    request:sign(),stripeSdk:sdk,webhookSigningSecret:webhookSecret,
    retrievedSession:session,order,checkedAt:at,
    destinationSigningKey:shippingKey,previousEvents:new Map(),
    ...overrides
  });
}
test('composite signed event and matching Stripe+carrier totals is a NONEXECUTABLE reconciliation proposal',()=>{
  const d=audit();
  assert.equal(d.kind,'stripe-test-v2-inert-reconciliation');
  assert.equal(d.disposition,'RECONCILE_PAID_AND_STOCK_ATOMICALLY');
  assert.equal(d.totalAuditDisposition,'MATCHED_TEST_PAYMENT_REQUIRES_ATOMIC_RECONCILIATION');
  assert.equal(d.pendingAtomicSettlement,true);
  assert.equal(d.requiresHumanReview,false);
  for(const field of ['executable','paymentWriteAuthorized','stockWriteAuthorized','fulfillmentAuthorized','paymentCollectionEnabled'])
    assert.equal(d[field],false);
  assert.doesNotMatch(JSON.stringify(d),/123 Test Street|Whitman|02382|whsec_/);
});
test('tampered signature, wrong order, forged totals and different provider sessions fail closed',()=>{
  const request=sign();
  assert.throws(()=>audit({request:{...request,body:request.body.replace('1898','1900')}}),/Signature/);
  assert.throws(()=>audit({retrievedSession:{...session,id:'cs_test_other12345678'}}),/disagree/);
  assert.throws(()=>audit({retrievedSession:{...session,amount_total:100}}),/disagree/);
  assert.throws(()=>audit({retrievedSession:{...session,metadata:{orderId:'wrong'}}}),/disagree/);
  assert.throws(()=>audit({retrievedSession:{...session,payment_status:'unpaid'}}),/disagree/);
});
test('same-state changed street, quote timeout and missing HMAC key cannot result in paid readiness',()=>{
  assert.throws(()=>audit({retrievedSession:{
    ...session,collected_information:{shipping_details:{address:{...address,line1:'999 Other Road'}}}
  }}),/address differs/);
  assert.throws(()=>audit({order:{...order,carrierQuoteExpiresAt:'2026-10-09T19:59:00Z'}}),/expired/);
  assert.throws(()=>audit({destinationSigningKey:undefined}),/server-only HMAC key/);
});
test('verified paid event after reservation expiry flags human reconciliation, never stock capture',()=>{
  const d=audit({checkedAt:'2026-10-09T20:26:00Z'});
  assert.equal(d.totalAuditDisposition,'LATE_PAYMENT_REQUIRES_REVIEW');
  assert.equal(d.disposition,'REVIEW_LATE_PAYMENT_AND_REFUND_POLICY');
  assert.equal(d.pendingAtomicSettlement,false);
  assert.equal(d.requiresHumanReview,true);
  assert.equal(d.stockWriteAuthorized,false);
});
test('signed completed-but-unpaid event is not payment proof',()=>{
  const unpaidSession={...session,payment_status:'unpaid',payment_intent:null};
  const unpaidEvent={...event,data:{object:unpaidSession}};
  const d=audit({request:sign(unpaidEvent),retrievedSession:unpaidSession});
  assert.equal(d.disposition,'WAIT_FOR_VERIFIED_PAYMENT');
  assert.equal(d.totalAuditDisposition,'AWAIT_PROVIDER_PAYMENT');
  assert.equal(d.pendingAtomicSettlement,false);
  assert.equal(d.paymentWriteAuthorized,false);
});
test('durably recorded identical event ID is replay/no-op; altered fingerprint fails',()=>{
  const evt={eventId:event.id,type:event.type,mode:'test',sessionId:session.id,
    orderId:order.orderId,paymentStatus:'paid',amountTotalCents:1898,currency:'usd'};
  const fingerprint=verifiedWebhookEventFingerprint(evt);
  const previousEvents=new Map([[event.id,{fingerprint}]]);
  const d=audit({previousEvents});
  assert.equal(d.duplicateEvent,true);
  assert.equal(d.pendingAtomicSettlement,false);
  assert.equal(d.stockWriteAuthorized,false);
  assert.throws(()=>audit({previousEvents:new Map([[event.id,{fingerprint:'tampered'}]])}),/collision/);
});
