import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {verifyStripeSandboxEnvelope} from '../backend/stripe-sandbox-webhook-boundary.mjs';
import {reviewSignedTestPaymentEvent} from '../backend/payment-webhook-review.mjs';

// These tests simulate the SDK callback contract with a signature-checking
// stub. A separate CI suite tests the actual Stripe SDK from backend deps.
const secret='whsec_sandboxonly_test_fake_123456789';
const at=Date.parse('2026-10-09T18:30:00Z')/1000;
const session={
  id:'cs_test_abcdefgh123456',object:'checkout.session',livemode:false,
  mode:'payment',client_reference_id:'order-01',metadata:{orderId:'order-01'},
  currency:'usd',amount_total:1399,payment_status:'paid'
};
const stripeEvent={
  id:'evt_abc123456789',type:'checkout.session.completed',
  livemode:false,data:{object:session}
};
const order={
  orderId:'order-01',stripeSessionId:session.id,paymentMode:'test',
  version:3,status:'RESERVED',paymentStatus:'PENDING',fulfillmentStatus:'UNFULFILLED',
  subtotalCents:1000,shippingCents:299,taxCents:100,totalCents:1399,currency:'usd',
  shippingCountry:'US',shippingMethod:'domestic_shipping',pickupAvailable:false,
  reservedUntil:'2026-10-09T19:00:00Z',items:[{productId:'physical-id',qty:1}]
};
function signedRequest(value=stripeEvent,{base64=false,now=at}={}){
  const body=JSON.stringify(value);
  const digest=createHmac('sha256',secret).update(now+'.'+body).digest('hex');
  return {
    requestContext:{http:{method:'POST'}},
    headers:{'Stripe-Signature':'t='+now+',v1='+digest},
    body:base64?Buffer.from(body,'utf8').toString('base64'):body,
    isBase64Encoded:base64
  };
}
const sdk={
  webhooks:{constructEvent(raw,header,provided,tolerance){
    assert.equal(tolerance,300);
    assert.equal(provided,secret);
    assert.equal(Buffer.isBuffer(raw),true);
    const match=/^t=(\d+),v1=([a-f0-9]{64})$/.exec(header);
    if(!match||Math.abs(at-Number(match[1]))>tolerance)throw Error('Invalid signature timestamp');
    const expected=createHmac('sha256',provided).update(match[1]+'.').update(raw).digest();
    const given=Buffer.from(match[2],'hex');
    if(!timingSafeEqual(given,expected))throw Error('Invalid HMAC signature');
    return JSON.parse(raw.toString('utf8'));
  }}
};
const check=(request=signedRequest(),overrides={})=>
  verifyStripeSandboxEnvelope({request,stripeSdk:sdk,webhookSigningSecret:secret,...overrides});

test('normalizes signed sandbox event without customer PII, card data or execution',()=>{
  const envelope=check(signedRequest({...stripeEvent,data:{object:{
    ...session,customer_details:{email:'private@example.com',name:'Private'},
    shipping_details:{address:{line1:'PII'}}}}}));
  assert.deepEqual(envelope.event,{
    eventId:stripeEvent.id,type:stripeEvent.type,mode:'test',sessionId:session.id,
    orderId:order.orderId,paymentStatus:'paid',amountTotalCents:1399,currency:'usd'
  });
  assert.deepEqual(envelope.trust,{signatureVerified:true,verifiedBy:'stripe-sdk-raw-body'});
  assert.equal(envelope.executionAllowed,false);
  assert.equal(envelope.paymentWriteAuthorized,false);
  assert.equal(envelope.fulfillmentAuthorized,false);
  assert.equal(envelope.stockWriteAuthorized,false);
  assert.doesNotMatch(JSON.stringify(envelope),/private@example.com|line1/);
});
test('accepts exact AWS base64 encoded raw body and links safely to inert reconciliation model',()=>{
  const env=check(signedRequest(stripeEvent,{base64:true}));
  const out=reviewSignedTestPaymentEvent({
    event:env.event,trust:env.trust,order,receivedAt:'2026-10-09T18:30:00Z',
    previousEvents:new Map()
  });
  assert.equal(out.disposition,'RECONCILE_PAID_AND_STOCK_ATOMICALLY');
  assert.equal(out.paymentWriteAuthorized,false);
  assert.equal(out.fulfillmentAuthorized,false);
});
test('fails signed-event validation on payload tamper and signature replay outside tolerance',()=>{
  const request=signedRequest();
  assert.throws(()=>check({...request,body:request.body.replace('1399','1499')}),/signature/i);
  assert.throws(()=>check(signedRequest(stripeEvent,{now:at-3600})),/timestamp/i);
  assert.throws(()=>check({...request,headers:{'Stripe-Signature':'t=123,v1='+'0'.repeat(64)}}),/timestamp/i);
});
test('requires POST, signing secret, SDK verifier and exactly one Stripe header',()=>{
  assert.throws(()=>check({...signedRequest(),requestContext:{http:{method:'GET'}}}),/POST/);
  assert.throws(()=>check(signedRequest(),{webhookSigningSecret:'sk_test_bad'}),/signing secret/);
  assert.throws(()=>check(signedRequest(),{stripeSdk:{}}),/official Stripe SDK/);
  assert.throws(()=>check({...signedRequest(),headers:{}}),/Exactly one/);
  const request=signedRequest();
  assert.throws(()=>check({...request,headers:{...request.headers,'stripe-signature':'duplicate'}}),/Exactly one/);
  assert.throws(()=>check({...request,multiValueHeaders:{'stripe-signature':['first','second']}}),/Ambiguous/);
});
test('rejects malformed base64, oversized body, non-string or empty payload',()=>{
  const r=signedRequest(stripeEvent,{base64:true});
  assert.throws(()=>check({...r,body:r.body+'@@@@'}),/base64/);
  assert.throws(()=>check({...r,body:r.body+'='}),/base64/);
  assert.throws(()=>check({...r,body:''}),/missing or oversized/);
  assert.throws(()=>check({...r,body:'x'.repeat(256*1024*2+1)}),/missing or oversized/);
  assert.throws(()=>check({...r,body:null}),/missing or oversized/);
});
test('signed live sessions, unexpected event types, mismatched order references or missing totals fail closed',()=>{
  const variants=[
    {...stripeEvent,livemode:true},
    {...stripeEvent,type:'charge.succeeded'},
    {...stripeEvent,data:{object:{...session,livemode:true}}},
    {...stripeEvent,data:{object:{...session,id:'cs_live_abcdefgh123456'}}},
    {...stripeEvent,data:{object:{...session,metadata:{orderId:'other'}}}},
    {...stripeEvent,data:{object:{...session,client_reference_id:'other'}}},
    {...stripeEvent,data:{object:{...session,mode:'subscription'}}},
    {...stripeEvent,data:{object:{...session,amount_total:null}}},
    {...stripeEvent,data:{object:{...session,currency:'cad'}}}
  ];
  for(const value of variants)assert.throws(()=>check(signedRequest(value)));
});
test('signed-but-unpaid completion does not imply payment; failed and expired events never release stock',()=>{
  for(const [type,status] of [
    ['checkout.session.completed','unpaid'],
    ['checkout.session.async_payment_failed','unpaid'],
    ['checkout.session.expired','unpaid']
  ]){
    const signed={...stripeEvent,type,data:{object:{...session,payment_status:status}}};
    const env=check(signedRequest(signed));
    const out=reviewSignedTestPaymentEvent({
      event:env.event,trust:env.trust,order,receivedAt:'2026-10-09T18:30:00Z',
      previousEvents:new Map()
    });
    assert.notEqual(out.disposition,'RECONCILE_PAID_AND_STOCK_ATOMICALLY');
    assert.equal(out.stockReservationAction,'NONE');
  }
});
