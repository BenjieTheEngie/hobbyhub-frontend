import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {verifyStripeSandboxEnvelope} from '../backend/stripe-sandbox-webhook-boundary.mjs';
import {retrieveSignedStripeTestSession} from '../backend/stripe-test-session-fetch.mjs';

// This test installs dependencies from backend/package.json and uses the
// actual official Stripe SDK's raw-body HMAC + timestamp verification.
// No Stripe API/network request, customer or account credential is involved.
const requireBackend=createRequire(new URL('../backend/package.json',import.meta.url));
const Stripe=requireBackend('stripe');
const stripe=new Stripe('sk_test_offline_placeholder_not_a_real_key');
const secret='whsec_offline_CI_secret_not_an_endpoint';
const data={
  id:'evt_abc12345678',type:'checkout.session.completed',livemode:false,
  data:{object:{
    object:'checkout.session',id:'cs_test_abcd1234567890',livemode:false,
    client_reference_id:'order_ci_100',metadata:{orderId:'order_ci_100'},
    mode:'payment',currency:'usd',amount_total:1599,payment_status:'paid'
  }}
};
function requestFromPayload(payload){
  return {
    httpMethod:'POST',body:payload,isBase64Encoded:false,
    headers:{'stripe-signature':stripe.webhooks.generateTestHeaderString({payload,secret})}
  };
}
test('real Stripe SDK validates offline signed Checkout test event without activating payments',()=>{
  const payload=JSON.stringify(data);
  const result=verifyStripeSandboxEnvelope({
    request:requestFromPayload(payload),stripeSdk:stripe,webhookSigningSecret:secret
  });
  assert.equal(result.event.orderId,'order_ci_100');
  assert.equal(result.event.amountTotalCents,1599);
  assert.equal(result.executionAllowed,false);
  assert.equal(result.paymentWriteAuthorized,false);
});
test('real Stripe SDK rejects tampered raw payload, wrong secret and expired signatures',()=>{
  const payload=JSON.stringify(data);
  const request=requestFromPayload(payload);
  assert.throws(()=>verifyStripeSandboxEnvelope({
    request:{...request,body:payload.replace('1599','1500')},
    stripeSdk:stripe,webhookSigningSecret:secret
  }),/signature/i);
  assert.throws(()=>verifyStripeSandboxEnvelope({
    request,stripeSdk:stripe,webhookSigningSecret:'whsec_some_other_signing_secret'
  }),/signature/i);
  const timestamp=Math.floor(Date.now()/1000)-3600;
  const oldHeader=stripe.webhooks.generateTestHeaderString({payload,secret,timestamp});
  assert.throws(()=>verifyStripeSandboxEnvelope({
    request:{...request,headers:{'stripe-signature':oldHeader}},
    stripeSdk:stripe,webhookSigningSecret:secret
  }),/timestamp/i);
});

test('official Stripe SDK signature gates server-owned TEST Checkout Session lookup',async()=>{
  const original=stripe.checkout.sessions.retrieve;
  const calls=[];
  stripe.checkout.sessions.retrieve=async(id)=>{
    calls.push(id);
    return {...data.data.object};
  };
  try{
    const payload=JSON.stringify(data);
    const result=await retrieveSignedStripeTestSession({
      request:requestFromPayload(payload),stripeSdk:stripe,webhookSigningSecret:secret
    });
    assert.equal(result.session.id,data.data.object.id);
    assert.deepEqual(calls,[data.data.object.id]);
    const bad=requestFromPayload(payload);
    bad.body=payload.replace('1599','1000');
    await assert.rejects(()=>retrieveSignedStripeTestSession({
      request:bad,stripeSdk:stripe,webhookSigningSecret:secret
    }),/signature/i);
    assert.equal(calls.length,1,'Tampered provider event must not trigger Stripe lookup');
    stripe.checkout.sessions.retrieve=async(id)=>{
      calls.push(id);
      return {...data.data.object,livemode:true};
    };
    await assert.rejects(()=>retrieveSignedStripeTestSession({
      request:requestFromPayload(payload),stripeSdk:stripe,webhookSigningSecret:secret
    }),/TEST Checkout Session/);
  }finally{
    stripe.checkout.sessions.retrieve=original;
  }
});
