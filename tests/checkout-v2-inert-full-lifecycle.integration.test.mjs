import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {validateCheckoutIntent,verifyCheckoutQuote} from '../backend/checkout-v2-core.mjs';
import {parcelsForVerifiedCart} from '../backend/carrier-rating-v2.mjs';
import {composeOfflineLiveCarrierCommitment} from '../backend/carrier-live-commitment-offline.mjs';
import {buildIdempotentReservationPlan} from '../backend/checkout-reservations-v2.mjs';
import {planBindStripeTestCheckoutSession} from '../backend/stripe-test-session-binding-plan.mjs';
import {planFinalizeSignedStripeTestOrderTotals} from '../backend/stripe-test-signed-tax-finalization-plan.mjs';
import {recordVerifiedStripeTestEventForReview} from '../backend/stripe-test-event-inbox.mjs';
import {reviewStripeTestCheckoutReconciliation} from '../backend/stripe-v2-reconciliation.mjs';
import {planStripeTestAtomicCapture} from '../backend/stripe-test-atomic-capture-plan.mjs';

const TABLES={
  orderTable:'hobbyhub-checkout-v2-sandbox-foundation-OrdersV2-TEST12345',
  stockTable:'hobbyhub-checkout-v2-sandbox-foundation-StockV2-TEST12345',
  eventTable:'hobbyhub-stripe-sandbox-ledgers-StripeTestEventLedger-1TS67SSV8ILV5',
  requestTable:'hobbyhub-stripe-sandbox-ledgers-StripeTestCheckoutRequestLedger-12OAC8XV01K6S'
};
const key=Buffer.from('offline-merchant-address-HMAC-only-not-an-AWS-secret');
const webhookSecret='whsec_OFFLINE_not_real_checkout_lifecycle_secret';
const clock='2026-10-10T02:05:00Z',unix=Date.parse(clock)/1000;
const address={recipient:'Test Buyer',country:'US',state:'WA',postalCode:'98101',
  city:'Seattle',line1:'22 Fictional Lane',line2:''};
const stripeAddress={country:'US',state:'WA',postal_code:'98101',
  city:'Seattle',line1:'22 Fictional Lane',line2:''};
const product={productId:'physical-card-1',sku:'MTG-REAL-001',
  productName:'Demo card bundle',published:true,status:'ACTIVE',salePrice:6,
  shippingPackage:{lengthIn:8,widthIn:5,heightIn:1,weightOz:6}};
const requestId='7cf18d40-0a57-4f45-af9f-fb5d478cf5a0';
const sessionId='cs_test_abcdefgh123456';
const eventId='evt_abcdefgh123456';
function carrierReservation(){
  const intent=validateCheckoutIntent({requestId,
    items:[{productId:product.productId,qty:2}]});
  const products=new Map([[product.productId,product]]);
  const q=verifyCheckoutQuote(intent,{
    productsById:products,
    stockById:new Map([[product.productId,{productId:product.productId,
      version:4,onHand:9,reserved:1}]]),
    skuCounts:new Map([['mtg-real-001',1]])
  });
  const measured=parcelsForVerifiedCart(intent,products);
  const rateDetails=[
    {productId:product.productId,unit:1,provider:'easypost',
      mode:'live',rateId:'rate_abcdefgh123456',carrier:'USPS',
      service:'GroundAdvantage',shippingCents:450,currency:'usd'},
    {productId:product.productId,unit:2,provider:'easypost',
      mode:'live',rateId:'rate_qwertyuiop123456',carrier:'USPS',
      service:'GroundAdvantage',shippingCents:400,currency:'usd'}
  ];
  const bound=composeOfflineLiveCarrierCommitment({
    productQuote:q,measuredParcels:measured,selectedRates:rateDetails,
    destination:address,destinationSigningKey:key,
    addressDeliverabilityVerified:true,checkedAt:'2026-10-10T02:00:00Z',
    holdUntil:'2026-10-10T02:30:00Z',
    carrierQuoteExpiresAt:'2026-10-10T03:00:00Z'
  });
  return buildIdempotentReservationPlan(bound,{
    stockTable:TABLES.stockTable,orderTable:TABLES.orderTable,
    idempotencyTable:TABLES.requestTable,
    orderId:'order-123',now:'2026-10-10T02:00:00Z',
    holdUntil:'2026-10-10T02:30:00Z'
  });
}
const openSession=(order)=>({
  object:'checkout.session',id:sessionId,livemode:false,mode:'payment',
  client_reference_id:order.orderId,metadata:{orderId:order.orderId},
  currency:'usd',status:'open',payment_status:'unpaid',
  automatic_tax:{enabled:true,status:'requires_location_inputs'},
  amount_subtotal:order.subtotalCents,
  shipping_cost:{amount_total:order.shippingCents}
});
const paidSession=(order)=>({
  ...openSession(order),status:'complete',payment_status:'paid',
  payment_intent:'pi_abcdefgh123456',
  automatic_tax:{enabled:true,status:'complete'},
  amount_total:2145,total_details:{amount_tax:95,amount_discount:0},
  collected_information:{shipping_details:{address:stripeAddress}}
});
function signedEvent(session){
  const event={id:eventId,livemode:false,type:'checkout.session.completed',
    data:{object:session}};
  const body=JSON.stringify(event);
  const digest=createHmac('sha256',webhookSecret).update(unix+'.'+body).digest('hex');
  return {httpMethod:'POST',body,isBase64Encoded:false,
    headers:{'Stripe-Signature':'t='+unix+',v1='+digest}};
}
function sdk(session,operations){
  return {
    webhooks:{constructEvent(raw,header,secret,tolerance){
      operations.push('verify-signature');
      assert.equal(secret,webhookSecret);
      assert.equal(tolerance,300);
      const match=/^t=(\d+),v1=([a-f0-9]{64})$/.exec(header);
      if(!match)throw Error('Wrong Stripe webhook header');
      const mac=createHmac('sha256',secret)
        .update(match[1]+'.').update(raw).digest();
      if(!timingSafeEqual(mac,Buffer.from(match[2],'hex')))
        throw Error('Stripe Signature mismatch');
      return JSON.parse(raw.toString('utf8'));
    }},
    checkout:{sessions:{async retrieve(id){
      operations.push('retrieve-session');
      assert.equal(id,sessionId);
      return session;
    }}}
  };
}
function mockLedger(){
  const rows=new Map(),operations=[];
  return {
    rows,operations,
    async get(p){
      operations.push('get');
      assert.equal(p.TableName,TABLES.eventTable);
      assert.equal(p.ConsistentRead,true);
      const value=rows.get(p.Key.eventId);
      return value?{Item:structuredClone(value)}:{};
    },
    async put(p){
      operations.push('put');
      assert.equal(p.TableName,TABLES.eventTable);
      assert.equal(p.ConditionExpression,'attribute_not_exists(eventId)');
      if(rows.has(p.Item.eventId)){
        const e=new Error('duplicate');e.name='ConditionalCheckFailedException';
        throw e;
      }
      rows.set(p.Item.eventId,structuredClone(p.Item));
      return {};
    }
  };
}
test('full source-only pipeline: reserve -> Stripe TEST bind -> signed tax -> event receipt -> atomic capture plan -> no-write replay',async()=>{
  const reserved=carrierReservation();
  assert.equal(reserved.kind,'offline-reservation-plan');
  assert.equal(reserved.executable,false);
  assert.equal(reserved.paymentReady,false);
  assert.equal(reserved.order.version,1);
  assert.equal(reserved.order.shippingState,'WA');
  assert.equal(reserved.order.taxCents,null);
  assert.equal(reserved.order.totalCents,null);
  assert.equal(reserved.order.paymentSessionId,undefined);
  assert.equal(reserved.transactItems.length,3);

  // Simulate a successful conditional order binding only inside test memory.
  const attach=planBindStripeTestCheckoutSession({
    order:reserved.order,retrievedSession:openSession(reserved.order),
    orderTable:TABLES.orderTable,now:'2026-10-10T02:01:00Z'
  });
  assert.equal(attach.executable,false);
  assert.equal(attach.nextOrderVersion,2);
  const bound={...reserved.order,version:2,paymentMode:'test',
    stripeSessionId:sessionId,paymentSessionId:sessionId};

  const provider=paidSession(bound);
  const webhook=signedEvent(provider);
  const calls=[];
  const serverSdk=sdk(provider,calls);
  const finalize=await planFinalizeSignedStripeTestOrderTotals({
    request:webhook,stripeSdk:serverSdk,webhookSigningSecret:webhookSecret,
    order:bound,checkedAt:clock,destinationSigningKey:key,
    orderTable:TABLES.orderTable
  });
  assert.equal(finalize.executable,false);
  assert.equal(finalize.taxCents,95);
  assert.equal(finalize.totalCents,2145);
  assert.equal(finalize.nextOrderVersion,3);
  assert.equal(finalize.orderStatus,'RESERVED');
  assert.equal(finalize.paymentStatus,'PENDING');
  assert.deepEqual(calls.slice(0,3),
    ['verify-signature','retrieve-session','verify-signature']);
  const finalized={...bound,version:3,taxCents:finalize.taxCents,
    totalCents:finalize.totalCents};

  // The signed inbox records only an event receipt, never a payment.
  const ledger=mockLedger();
  const receipt=await recordVerifiedStripeTestEventForReview({
    request:webhook,stripeSdk:serverSdk,webhookSigningSecret:webhookSecret,
    order:finalized,checkedAt:clock,destinationSigningKey:key,
    ledgerClient:ledger,eventTable:TABLES.eventTable
  });
  assert.equal(receipt.state,'PENDING_REVIEW');
  assert.equal(receipt.requiresDurableSettlement,true);
  assert.deepEqual(ledger.operations,['get','put']);
  assert.equal(ledger.rows.size,1);
  const eventRow=ledger.rows.get(eventId);
  assert.match(eventRow.fingerprint,/^[a-f0-9]{64}$/);

  // Fresh provider review + strongly-consistent Order/Stock/event snapshots
  // are required before ANY future executable DynamoDB transaction.
  const review=reviewStripeTestCheckoutReconciliation({
    request:webhook,stripeSdk:serverSdk,webhookSigningSecret:webhookSecret,
    retrievedSession:provider,order:finalized,checkedAt:clock,
    destinationSigningKey:key,previousEvents:new Map()
  });
  assert.equal(review.pendingAtomicSettlement,true);
  const captured=planStripeTestAtomicCapture({
    review,eventRow,order:finalized,now:clock,
    stockById:new Map([[product.productId,{
      productId:product.productId,version:5,onHand:9,reserved:3
    }]]),
    stockTable:TABLES.stockTable,orderTable:TABLES.orderTable,
    eventTable:TABLES.eventTable
  });
  assert.equal(captured.executable,false);
  assert.equal(captured.transactItems.length,3);
  assert.ok(captured.transactItems.every(x=>x.Update));
  assert.equal(captured.transactItems[0].Update.TableName,TABLES.stockTable);
  assert.equal(captured.transactItems[1].Update.TableName,TABLES.orderTable);
  assert.equal(captured.transactItems[2].Update.TableName,TABLES.eventTable);
  assert.equal(captured.transactItems[2].Update.Key.eventId,eventId);
  assert.equal(captured.transactItems[2].Update.ExpressionAttributeValues[':nextOrderVersion'],4);

  // Simulated future all-or-nothing transaction result, no actual AWS write.
  ledger.rows.set(eventId,{...eventRow,state:'SETTLED',
    settledOrderVersion:4,settledAt:'2026-10-10T02:05:00.000Z'});
  const paid={...finalized,version:4,status:'PAID',paymentStatus:'PAID',
    paymentEventId:eventId};
  const replay=await recordVerifiedStripeTestEventForReview({
    request:webhook,stripeSdk:serverSdk,webhookSigningSecret:webhookSecret,
    order:paid,checkedAt:clock,destinationSigningKey:key,
    ledgerClient:ledger,eventTable:TABLES.eventTable
  });
  assert.equal(replay.state,'SETTLED');
  assert.equal(replay.alreadyRecorded,true);
  assert.equal(replay.requiresDurableSettlement,false);
  assert.equal(ledger.operations.filter(x=>x==='put').length,1);
  const serialized=JSON.stringify({reserved,attach,finalize,receipt,captured,replay});
  for(const sensitive of ['22 Fictional Lane','98101','Test Buyer',
    'offline-merchant-address-HMAC','whsec_','sk_test_'])
    assert.equal(serialized.includes(sensitive),false,'Sensitive text in plan: '+sensitive);
});
test('changed street at the same carrier charge blocks signed tax and event processing',async()=>{
  const original=carrierReservation().order;
  const bound={...original,version:2,paymentMode:'test',
    stripeSessionId:sessionId,paymentSessionId:sessionId};
  const altered=paidSession(bound);
  altered.collected_information={shipping_details:{address:{
    ...stripeAddress,line1:'99 Different Avenue'
  }}};
  // The signed event cannot override the original address HMAC.
  await assert.rejects(()=>planFinalizeSignedStripeTestOrderTotals({
    request:signedEvent(altered),stripeSdk:sdk(altered,[]),
    webhookSigningSecret:webhookSecret,order:bound,checkedAt:clock,
    destinationSigningKey:key,orderTable:TABLES.orderTable
  }),/address differs/);
});
