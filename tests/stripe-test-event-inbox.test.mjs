import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {recordVerifiedStripeTestEventForReview} from '../backend/stripe-test-event-inbox.mjs';
import {shippingDestinationHmac} from '../backend/stripe-shipping-bind.mjs';

const TABLE='hobbyhub-stripe-sandbox-ledgers-StripeTestEventLedger-1TS67SSV8ILV5';
const secret='whsec_OFFLINE_ONLY_NOT_REAL';
const addressKey=Buffer.from('offline-test-address-HMAC-key-not-used-in-AWS');
const checkedAt='2026-10-10T02:00:00Z';
const secs=Date.parse(checkedAt)/1000;
const address={country:'US',state:'MA',postal_code:'02382',city:'Whitman',
  line1:'123 Test Street',line2:''};
const order={
  orderId:'order-123',stripeSessionId:'cs_test_abcdefgh123456',
  paymentMode:'test',version:2,status:'RESERVED',paymentStatus:'PENDING',
  fulfillmentStatus:'UNFULFILLED',currency:'usd',shippingCountry:'US',
  shippingMethod:'domestic_shipping',pickupAvailable:false,
  shippingState:'MA',shippingAddressVerified:true,
  shippingDestinationDigest:shippingDestinationHmac(address,addressKey),
  carrierQuoteExpiresAt:'2026-10-10T02:30:00Z',
  reservedUntil:'2026-10-10T02:25:00Z',
  subtotalCents:1200,shippingCents:599,taxCents:99,totalCents:1898,
  items:[{productId:'physical-id-01',qty:2,unitPriceCents:600,lineTotalCents:1200}]
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
const event={id:'evt_abcdefgh123456',livemode:false,
  type:'checkout.session.completed',data:{object:session}};
function requestFor(e=event){
  const body=JSON.stringify(e);
  const signature=createHmac('sha256',secret).update(secs+'.'+body).digest('hex');
  return {httpMethod:'POST',body,isBase64Encoded:false,
    headers:{'Stripe-Signature':'t='+secs+',v1='+signature}};
}
const sdk={webhooks:{constructEvent(raw,header,webhookSecret,tolerance){
  assert.equal(webhookSecret,secret);
  assert.equal(tolerance,300);
  const m=/^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  if(!m||Number(m[1])!==secs)throw Error('Signature timestamp invalid');
  const expected=createHmac('sha256',webhookSecret).update(m[1]+'.').update(raw).digest();
  if(!timingSafeEqual(expected,Buffer.from(m[2],'hex')))throw Error('Signature mismatch');
  return JSON.parse(raw.toString('utf8'));
}}};

function store(){
  const rows=new Map();const calls=[];
  let mode='normal';
  const client={
    calls,rows,setMode(next){mode=next},
    async get(params){
      calls.push({operation:'get',params});
      assert.equal(params.TableName,TABLE);
      assert.equal(params.ConsistentRead,true);
      if(mode==='get-failure')throw Error('DynamoDB timeout');
      const row=rows.get(params.Key.eventId);
      return row?{Item:structuredClone(row)}:{};
    },
    async put(params){
      calls.push({operation:'put',params});
      assert.equal(params.TableName,TABLE);
      assert.equal(params.ConditionExpression,'attribute_not_exists(eventId)');
      if(mode==='put-failure')throw Error('DynamoDB timeout');
      if(rows.has(params.Item.eventId)){
        const e=new Error('conditional conflict');
        e.name='ConditionalCheckFailedException';throw e;
      }
      rows.set(params.Item.eventId,structuredClone(params.Item));
      return {};
    }
  };
  return client;
}
function args(ledgerClient,overrides={}){
  return {
    request:requestFor(),stripeSdk:sdk,webhookSigningSecret:secret,
    retrievedSession:session,order,checkedAt,destinationSigningKey:addressKey,
    ledgerClient,eventTable:TABLE,...overrides
  };
}
function noSideEffects(receipt){
  for(const field of ['paymentWriteAuthorized','stockWriteAuthorized',
    'fulfillmentAuthorized','checkoutEnabled'])
    assert.equal(receipt[field],false,field);
  assert.equal(receipt.requiresDurableSettlement,true);
}
test('signed Stripe TEST payment creates only one PENDING_REVIEW event row, never marks an order paid',async()=>{
  const client=store();
  const receipt=await recordVerifiedStripeTestEventForReview(args(client));
  assert.equal(receipt.state,'PENDING_REVIEW');
  assert.equal(receipt.alreadyRecorded,false);
  noSideEffects(receipt);
  assert.deepEqual(client.calls.map(x=>x.operation),['get','put']);
  assert.deepEqual([...client.rows.keys()],[event.id]);
  const record=client.rows.get(event.id);
  assert.equal(record.state,'PENDING_REVIEW');
  assert.equal(record.eventId,event.id);
  assert.equal(record.orderId,order.orderId);
  assert.equal(record.sessionId,session.id);
  assert.equal(record.schemaVersion,1);
  assert.match(record.fingerprint,/^[0-9a-f]{64}$/);
  assert.equal(record.reviewDisposition,'RECONCILE_PAID_AND_STOCK_ATOMICALLY');
  assert.equal(record.totalAuditDisposition,'MATCHED_TEST_PAYMENT_REQUIRES_ATOMIC_RECONCILIATION');
  assert.equal(record.recordedAt,new Date(checkedAt).toISOString());
  assert.equal(Object.hasOwn(record,'ttl'),false);
  assert.equal(Object.hasOwn(record,'expiresAt'),false);
  assert.equal(Object.hasOwn(record,'customer'),false);
  assert.equal(Object.hasOwn(record,'address'),false);
  const serialized=JSON.stringify(record);
  for(const sensitive of ['123 Test Street','Whitman','02382','whsec_','sk_test_',
    'payment_intent','pi_abcdefgh123456'])
    assert.equal(serialized.includes(sensitive),false,'Persisted sensitive field '+sensitive);
});
test('repeated delivery of exact same event uses consistent read and causes no second write',async()=>{
  const client=store();
  await recordVerifiedStripeTestEventForReview(args(client));
  const second=await recordVerifiedStripeTestEventForReview(args(client));
  assert.equal(second.alreadyRecorded,true);
  noSideEffects(second);
  assert.deepEqual(client.calls.map(x=>x.operation),['get','put','get']);
  assert.equal(client.rows.size,1);
});
test('two concurrent replicas race on atomic conditional Put and exactly one stores event',async()=>{
  const client=store();
  const [a,b]=await Promise.all([
    recordVerifiedStripeTestEventForReview(args(client)),
    recordVerifiedStripeTestEventForReview(args(client))
  ]);
  assert.deepEqual([a.alreadyRecorded,b.alreadyRecorded].sort(),[false,true]);
  assert.equal(client.rows.size,1);
  noSideEffects(a);noSideEffects(b);
  assert.equal(client.calls.filter(c=>c.operation==='put').length,2);
  assert.equal(client.calls.filter(c=>c.operation==='get').length,3);
});
test('recording requires a valid raw-body Stripe signature and exact provider/order totals',async()=>{
  for(const change of [
    {request:{...requestFor(),body:requestFor().body.replace('1898','1800')}},
    {retrievedSession:{...session,amount_total:1899}},
    {retrievedSession:{...session,metadata:{orderId:'wrong'}}},
    {retrievedSession:{...session,collected_information:{
      shipping_details:{address:{...address,line1:'456 Other Street'}}}},
    },
    {order:{...order,taxCents:1}},
    {order:{...order,carrierQuoteExpiresAt:'2026-10-10T01:59:59Z'}},
    {destinationSigningKey:undefined}
  ]){
    const client=store();
    await assert.rejects(()=>recordVerifiedStripeTestEventForReview(args(client,change)));
    assert.equal(client.rows.size,0);
    assert.equal(client.calls.filter(x=>x.operation==='put').length,0);
  }
});
test('rejects live-mode events, mismatched checkout, untrusted table and missing dependencies',async()=>{
  const live={...event,livemode:true};
  for(const changes of [
    {request:requestFor(live)},
    {eventTable:'hobbyhub-InventoryTable-X2IRQDAGW7WB'},
    {eventTable:'hobbyhub-stripe-sandbox-ledgers-StripeTestCheckoutRequestLedger-12OAC8XV01K6S'},
    {eventTable:'hobbyhub-stripe-sandbox-ledgers-StripeTestEventLedger-*'},
    {eventTable:undefined},
    {ledgerClient:{}},
    {checkedAt:'not-an-iso-timestamp'}
  ]){
    const client=store();
    await assert.rejects(()=>recordVerifiedStripeTestEventForReview(args(client,changes)));
    assert.equal(client.rows.size,0);
  }
});
test('a duplicate event ID with a conflicting signed payload cannot overwrite or be accepted',async()=>{
  const client=store();
  await recordVerifiedStripeTestEventForReview(args(client));
  const maliciousSession={...session,amount_subtotal:1201,amount_total:1899};
  const malicious={...event,data:{object:maliciousSession}};
  await assert.rejects(()=>recordVerifiedStripeTestEventForReview(args(client,{
    request:requestFor(malicious),retrievedSession:maliciousSession,
    order:{...order,subtotalCents:1201,totalCents:1899,
      items:[{...order.items[0],unitPriceCents:600,lineTotalCents:1201}]}
  })));
  assert.equal(client.rows.size,1);
  assert.equal(client.calls.filter(c=>c.operation==='put').length,1);
});
test('corrupt ledger row, network errors and ambiguous conditional conflicts fail closed',async()=>{
  const client=store();
  client.rows.set(event.id,{eventId:event.id,fingerprint:'0'.repeat(64),state:'SETTLED'});
  await assert.rejects(()=>recordVerifiedStripeTestEventForReview(args(client)),/collision|inconsistent|review/i);
  client.rows.clear();client.setMode('get-failure');
  await assert.rejects(()=>recordVerifiedStripeTestEventForReview(args(client)),/timeout/);
  client.setMode('put-failure');
  await assert.rejects(()=>recordVerifiedStripeTestEventForReview(args(client)),/timeout/);
  assert.equal(client.rows.size,0);
});
test('unpaid completion is only logged as pending review, never treated as captured payment',async()=>{
  const client=store();
  const unpaid={...session,payment_status:'unpaid',payment_intent:null};
  const signed={...event,data:{object:unpaid}};
  const result=await recordVerifiedStripeTestEventForReview(args(client,{
    request:requestFor(signed),retrievedSession:unpaid
  }));
  assert.equal(client.rows.get(event.id).reviewDisposition,'WAIT_FOR_VERIFIED_PAYMENT');
  noSideEffects(result);
});
test('a paid event after reservation deadline is logged for human review only',async()=>{
  const client=store();
  const later='2026-10-10T02:26:00Z';
  const result=await recordVerifiedStripeTestEventForReview(args(client,{checkedAt:later}));
  assert.equal(client.rows.get(event.id).reviewDisposition,'REVIEW_LATE_PAYMENT_AND_REFUND_POLICY');
  noSideEffects(result);
});
