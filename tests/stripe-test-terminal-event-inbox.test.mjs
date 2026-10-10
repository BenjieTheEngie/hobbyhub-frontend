import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {recordSignedStripeTestTerminalEventForReview,recordSignedStripeTestUnpaidEventForReview} from '../backend/stripe-test-terminal-event-inbox.mjs';

const TABLE='hobbyhub-stripe-sandbox-ledgers-StripeTestEventLedger-1TS67SSV8ILV5';
const secret='whsec_offline_test_only_not_real';
const when='2026-10-10T12:40:00Z',secs=Date.parse(when)/1000;
const order={
  orderId:'order-123',stripeSessionId:'cs_test_abcdefgh123456',
  paymentSessionId:'cs_test_abcdefgh123456',
  paymentMode:'test',version:2,status:'RESERVED',paymentStatus:'PENDING',
  fulfillmentStatus:'UNFULFILLED',shippingCountry:'US',
  shippingMethod:'domestic_shipping',pickupAvailable:false,
  reservedUntil:'2026-10-10T12:55:00Z',
  taxCents:null,totalCents:null,
  shippingDestinationDigest:'hmac-v1-'+'a'.repeat(64)
};
const expiredSession={
  object:'checkout.session',id:order.stripeSessionId,
  mode:'payment',livemode:false,currency:'usd',
  client_reference_id:order.orderId,
  metadata:{orderId:order.orderId},status:'expired',
  payment_status:'unpaid',amount_total:1898,
  total_details:null,automatic_tax:{enabled:true,status:'requires_location_inputs'}
};
const failedSession={...expiredSession,status:'complete'};
const evt=(session=expiredSession,type='checkout.session.expired')=>({
  id:'evt_abcdefgh123456',livemode:false,type,data:{object:session}
});
function signed(e=evt()){
  const body=JSON.stringify(e);
  const mac=createHmac('sha256',secret).update(secs+'.'+body).digest('hex');
  return {httpMethod:'POST',isBase64Encoded:false,body,
    headers:{'Stripe-Signature':`t=${secs},v1=${mac}`}};
}
function sdk(provider,trace=[]){
  return {webhooks:{constructEvent(raw,header,key,tolerance){
    trace.push('verify');
    assert.equal(key,secret);
    assert.equal(tolerance,300);
    const m=/^t=(\d+),v1=([a-f0-9]{64})$/.exec(header);
    if(!m)throw Error('Stripe Signature malformed');
    const expected=createHmac('sha256',key).update(m[1]+'.').update(raw).digest();
    if(!timingSafeEqual(expected,Buffer.from(m[2],'hex')))
      throw Error('Stripe Signature mismatch');
    return JSON.parse(raw.toString('utf8'));
  }},checkout:{sessions:{async retrieve(id){
    trace.push('provider');
    assert.equal(id,order.stripeSessionId);
    return provider;
  }}}};
}
function db(){
  const rows=new Map(),operations=[];
  return {rows,operations,
    async get(params){
      operations.push('get');
      assert.equal(params.ConsistentRead,true);
      assert.equal(params.TableName,TABLE);
      const found=rows.get(params.Key.eventId);
      return found?{Item:structuredClone(found)}:{};
    },
    async put(params){
      operations.push('put');
      assert.equal(params.ConditionExpression,'attribute_not_exists(eventId)');
      assert.equal(params.TableName,TABLE);
      if(rows.has(params.Item.eventId)){
        const e=new Error('duplicate');
        e.name='ConditionalCheckFailedException';
        throw e;
      }
      rows.set(params.Item.eventId,structuredClone(params.Item));
      return {};
    }
  };
}
function args(ledgerClient,changes={}){
  return {request:signed(),stripeSdk:sdk(expiredSession),
    webhookSigningSecret:secret,order,
    checkedAt:when,ledgerClient,eventTable:TABLE,...changes};
}
function neverRelease(result){
  assert.equal(result.requiresManualReview,true);
  assert.equal(result.requiresDurablePaymentCheck,true);
  assert.equal(result.checkoutEnabled,false);
  for(const permission of ['stockReleaseAuthorized','stockWriteAuthorized',
    'paymentWriteAuthorized','fulfillmentAuthorized'])
    assert.equal(result[permission],false,permission);
}
test('signed expired unpaid TEST checkout is recorded without finalized tax or automatic stock release',async()=>{
  const client=db(),trace=[];
  const result=await recordSignedStripeTestTerminalEventForReview(args(client,{
    stripeSdk:sdk(expiredSession,trace)
  }));
  assert.deepEqual(trace,['verify','provider']);
  assert.deepEqual(client.operations,['get','put']);
  assert.equal(result.kind,'stripe-test-terminal-event-receipt');
  assert.equal(result.state,'PENDING_REVIEW');
  assert.equal(result.alreadyRecorded,false);
  assert.equal(result.holdStillActive,true);
  neverRelease(result);
  const row=client.rows.get(evt().id);
  assert.equal(row.schemaVersion,1);
  assert.equal(row.orderId,order.orderId);
  assert.equal(row.sessionId,order.stripeSessionId);
  assert.equal(row.provider,'stripe');
  assert.equal(row.mode,'test');
  assert.equal(row.state,'PENDING_REVIEW');
  assert.equal(row.reviewDisposition,'REVIEW_RELEASE_WITH_LATE_PAYMENT_SAFEGUARDS');
  assert.equal(row.totalAuditDisposition,'REVIEW_EXPIRED_SESSION_BEFORE_STOCK_RELEASE');
  assert.match(row.fingerprint,/^[a-f0-9]{64}$/);
  assert.equal(row.recordedAt,new Date(when).toISOString());
  const text=JSON.stringify({row,result});
  for(const privateValue of ['customer','address','123 Test Street','postalCode',
    'sk_test_','whsec_','payment_intent'])
    assert.equal(text.includes(privateValue),false,privateValue);
  assert.equal('ttl' in row,false);
});
test('signed completed but UNPAID TEST Checkout is recorded as awaiting payment, not final charge',async()=>{
  const client=db();
  const pending={...expiredSession,status:'complete'};
  const result=await recordSignedStripeTestUnpaidEventForReview(args(client,{
    request:signed(evt(pending,'checkout.session.completed')),
    stripeSdk:sdk(pending)
  }));
  const row=client.rows.get(evt().id);
  assert.equal(row.reviewDisposition,'WAIT_FOR_VERIFIED_PAYMENT');
  assert.equal(row.totalAuditDisposition,'AWAIT_PROVIDER_PAYMENT');
  assert.equal(row.state,'PENDING_REVIEW');
  assert.equal(result.requiresManualReview,false);
  assert.equal(result.requiresDurablePaymentCheck,true);
  assert.equal(result.stockReleaseAuthorized,false);
  assert.equal(result.paymentWriteAuthorized,false);
  assert.equal(result.stockWriteAuthorized,false);
  assert.equal(result.fulfillmentAuthorized,false);
  assert.equal(result.checkoutEnabled,false);
  assert.equal(result.holdStillActive,true);
  assert.equal(client.operations.filter(x=>x==='put').length,1);
  const repeated=await recordSignedStripeTestUnpaidEventForReview(args(client,{
    request:signed(evt(pending,'checkout.session.completed')),
    stripeSdk:sdk(pending)
  }));
  assert.equal(repeated.alreadyRecorded,true);
  assert.equal(repeated.requiresManualReview,false);
  assert.equal(client.operations.filter(x=>x==='put').length,1);
});
test('unpaid completed event cannot masquerade as paid or claim to be expired',async()=>{
  const client=db();
  const completed={...expiredSession,status:'complete'};
  const invalid=[
    {session:{...completed,payment_status:'paid'},type:'checkout.session.completed'},
    {session:{...completed,status:'open'},type:'checkout.session.completed'},
    {session:{...completed,status:'expired'},type:'checkout.session.completed'},
    {session:completed,type:'checkout.session.async_payment_succeeded'}
  ];
  for(const {session:provider,type} of invalid){
    await assert.rejects(()=>recordSignedStripeTestUnpaidEventForReview(args(client,{
      request:signed(evt(provider,type)),stripeSdk:sdk(provider)
    })));
  }
  assert.equal(client.rows.size,0);
});
test('one Stripe event ID cannot switch from pending completion to terminal expiry',async()=>{
  const client=db();
  const completed={...expiredSession,status:'complete'};
  await recordSignedStripeTestUnpaidEventForReview(args(client,{
    request:signed(evt(completed,'checkout.session.completed')),
    stripeSdk:sdk(completed)
  }));
  await assert.rejects(()=>recordSignedStripeTestUnpaidEventForReview(args(client,{
    request:signed(evt(expiredSession,'checkout.session.expired')),
    stripeSdk:sdk(expiredSession)
  })),/inconsistent|collision/);
  assert.equal(client.operations.filter(x=>x==='put').length,1);
});
test('signed async payment failure after hold expires remains manual review, never automatic restock',async()=>{
  const client=db();
  const signedFailure=signed(evt(failedSession,'checkout.session.async_payment_failed'));
  const result=await recordSignedStripeTestTerminalEventForReview(args(client,{
    request:signedFailure,stripeSdk:sdk(failedSession),
    checkedAt:'2026-10-10T13:00:00Z'
  }));
  assert.equal(result.holdStillActive,false);
  assert.equal(client.rows.get(evt().id).totalAuditDisposition,
    'REVIEW_PROVIDER_STATE_MISMATCH');
  neverRelease(result);
});
test('exact signed failed event duplicates are conditional no-writes, despite missing final tax',async()=>{
  const client=db();
  const first=await recordSignedStripeTestTerminalEventForReview(args(client));
  const replay=await recordSignedStripeTestTerminalEventForReview(args(client));
  assert.equal(first.alreadyRecorded,false);
  assert.equal(replay.alreadyRecorded,true);
  neverRelease(replay);
  assert.deepEqual(client.operations,['get','put','get']);
  assert.equal(client.rows.size,1);
});
test('concurrent race to insert the same terminal event does not overwrite first receipt',async()=>{
  const client=db();
  const result=await Promise.all([
    recordSignedStripeTestTerminalEventForReview(args(client)),
    recordSignedStripeTestTerminalEventForReview(args(client))
  ]);
  assert.deepEqual(result.map(r=>r.alreadyRecorded).sort(),[false,true]);
  assert.equal(client.rows.size,1);
  assert.equal(client.operations.filter(x=>x==='put').length,2);
  assert.equal(client.operations.filter(x=>x==='get').length,3);
  result.forEach(neverRelease);
});
test('invalid signature is rejected before contacting Stripe or DynamoDB',async()=>{
  const client=db(),trace=[];
  const request=signed();
  await assert.rejects(()=>recordSignedStripeTestTerminalEventForReview(args(client,{
    request:{...request,body:request.body.replace('1898','1899')},
    stripeSdk:sdk(expiredSession,trace)
  })),/Signature/);
  assert.deepEqual(trace,['verify']);
  assert.equal(client.operations.length,0);
});
test('wrong payment status, failed session status and wrong event kind never record terminal receipt',async()=>{
  for(const [provider,type] of [
    [{...expiredSession,status:'complete'},'checkout.session.expired'],
    [{...expiredSession,payment_status:'paid'},'checkout.session.expired'],
    [{...failedSession,status:'open'},'checkout.session.async_payment_failed'],
    [{...failedSession,payment_status:'paid'},'checkout.session.async_payment_failed']
  ]){
    const client=db();
    const request=signed(evt(provider,type));
    await assert.rejects(()=>recordSignedStripeTestTerminalEventForReview(args(client,{
      request,stripeSdk:sdk(provider)
    })),/unpaid Session/);
    assert.equal(client.operations.length,0);
  }
  const client=db();
  const paid={...expiredSession,status:'complete',payment_status:'paid'};
  await assert.rejects(()=>recordSignedStripeTestTerminalEventForReview(args(client,{
    request:signed(evt(paid,'checkout.session.completed')),
    stripeSdk:sdk(paid)
  })),/unpaid Session/);
  assert.equal(client.operations.length,0);
});
test('unbound, already-paid, wrong product order and final total conflict fail closed',async()=>{
  for(const changed of [
    {stripeSessionId:'cs_test_another123456'},
    {paymentSessionId:undefined},
    {paymentMode:'live'}, {status:'PAID'},
    {paymentStatus:'PAID'}, {fulfillmentStatus:'SHIPPED'},
    {version:1}, {version:0},
    {shippingCountry:'CA'}, {pickupAvailable:true},
    {totalCents:1900},{taxCents:-1},
    {reservedUntil:'invalid'}
  ]){
    const client=db();
    await assert.rejects(()=>recordSignedStripeTestTerminalEventForReview(args(client,{
      order:{...order,...changed}
    })));
    assert.equal(client.operations.length,0);
  }
});
test('invalid, settled or conflicting terminal-event row cannot hide provider event collision',async()=>{
  for(const change of [
    {state:'SETTLED'},
    {fingerprint:'f'.repeat(64)},
    {reviewDisposition:'RECONCILE_PAID_AND_STOCK_ATOMICALLY'},
    {totalAuditDisposition:'AWAIT_PROVIDER_PAYMENT'},
    {schemaVersion:2}
  ]){
    const client=db();
    await recordSignedStripeTestTerminalEventForReview(args(client));
    client.rows.set(evt().id,{...client.rows.get(evt().id),...change});
    await assert.rejects(()=>recordSignedStripeTestTerminalEventForReview(args(client)));
    assert.equal(client.operations.filter(x=>x==='put').length,1);
  }
});
test('only the exact TEST event table is permitted and SDK network errors never create rows',async()=>{
  for(const table of [
    'hobbyhub-InventoryTable-X2IRQDAGW7WB',
    'hobbyhub-stripe-sandbox-ledgers-StripeTestCheckoutRequestLedger-12OAC8XV01K6S',
    'hobbyhub-stripe-sandbox-ledgers-StripeTestEventLedger-*',
    undefined
  ]){
    const client=db();
    await assert.rejects(()=>recordSignedStripeTestTerminalEventForReview(args(client,{
      eventTable:table
    })),/isolated/);
    assert.equal(client.operations.length,0);
  }
  const client=db();
  await assert.rejects(()=>recordSignedStripeTestTerminalEventForReview(args(client,{
    stripeSdk:{...sdk(expiredSession),
      checkout:{sessions:{async retrieve(){throw Error('Stripe network failed');}}}}
  })),/network failed/);
  assert.equal(client.operations.length,0);
});
