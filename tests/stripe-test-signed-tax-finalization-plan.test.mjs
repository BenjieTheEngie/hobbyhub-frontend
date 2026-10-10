import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {shippingDestinationHmac} from '../backend/stripe-shipping-bind.mjs';
import {planFinalizeSignedStripeTestOrderTotals} from '../backend/stripe-test-signed-tax-finalization-plan.mjs';

const TABLE='hobbyhub-checkout-v2-sandbox-foundation-OrdersV2-TEST12345';
const signingSecret='whsec_this-is-an-inert-offline-fixture';
const destinationKey=Buffer.from('fake-local-hmac-key-32-chars-and-some-more');
const checkedAt='2026-10-10T02:05:00Z';
const secs=Date.parse(checkedAt)/1000;
const destination={country:'US',state:'WA',postal_code:'98101',
  city:'Seattle',line1:'22 Fictional Lane',line2:''};
const order={
  orderId:'order-123',
  checkoutRequestId:'7cf18d40-0a57-4f45-af9f-fb5d478cf5a0',
  version:2,status:'RESERVED',paymentStatus:'PENDING',
  fulfillmentStatus:'UNFULFILLED',paymentMode:'test',
  stripeSessionId:'cs_test_abcdefgh123456',
  paymentSessionId:'cs_test_abcdefgh123456',
  subtotalCents:1200,shippingCents:850,
  taxCents:null,totalCents:null,currency:'usd',
  shippingMethod:'domestic_shipping',shippingCountry:'US',
  shippingRegion:'contiguous',shippingState:'WA',
  pickupAvailable:false,shippingAddressVerified:true,
  shippingDestinationDigest:shippingDestinationHmac(destination,destinationKey),
  carrierQuoteExpiresAt:'2026-10-10T03:00:00.000Z',
  reservedUntil:'2026-10-10T02:30:00Z',
  rateMode:'live',rateProvider:'easypost',
  carrierRateIds:['rate_abcdefgh123456','rate_qwertyuiop123456'],
  carrierRateDetails:[{rateId:'rate_abcdefgh123456',shippingCents:450},
    {rateId:'rate_qwertyuiop123456',shippingCents:400}],
  ratedParcelCount:2,
  items:[{productId:'physical-123',qty:2,unitPriceCents:600,lineTotalCents:1200}]
};
const session={
  object:'checkout.session',id:order.stripeSessionId,
  livemode:false,mode:'payment',
  client_reference_id:order.orderId,metadata:{orderId:order.orderId},
  status:'complete',payment_status:'paid',currency:'usd',
  automatic_tax:{enabled:true,status:'complete'},
  amount_subtotal:1200,shipping_cost:{amount_total:850},
  total_details:{amount_tax:95,amount_discount:0},
  amount_total:2145,payment_intent:'pi_abcdefgh123456',
  collected_information:{shipping_details:{address:destination}}
};
const event={id:'evt_abcdefgh123456',livemode:false,
  type:'checkout.session.completed',data:{object:session}};
function signedRequest(e=event){
  const body=JSON.stringify(e);
  const v1=createHmac('sha256',signingSecret).update(secs+'.'+body).digest('hex');
  return {httpMethod:'POST',body,isBase64Encoded:false,
    headers:{'Stripe-Signature':'t='+secs+',v1='+v1}};
}
function sdk(retrieved=session,trace=null){
  return {
    webhooks:{constructEvent(raw,header,secret,tolerance){
      trace?.push('verify');
      assert.equal(secret,signingSecret);
      assert.equal(tolerance,300);
      const match=/^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
      if(!match)throw Error('Bad Stripe signature');
      const expected=createHmac('sha256',secret)
        .update(match[1]+'.').update(raw).digest();
      if(!timingSafeEqual(expected,Buffer.from(match[2],'hex')))
        throw Error('Stripe Signature mismatch');
      return JSON.parse(raw.toString('utf8'));
    }},
    checkout:{sessions:{async retrieve(id){
      trace?.push('retrieve');
      assert.equal(id,order.stripeSessionId);
      return retrieved;
    }}}
  };
}
function args(changes={}){
  return {
    request:signedRequest(),stripeSdk:sdk(),
    webhookSigningSecret:signingSecret,order,
    checkedAt,destinationSigningKey:destinationKey,
    orderTable:TABLE,...changes
  };
}
test('signed paid Stripe TEST webhook generates one inert optimistic tax/total update without stock settlement',async()=>{
  const calls=[];
  const plan=await planFinalizeSignedStripeTestOrderTotals(args({stripeSdk:sdk(session,calls)}));
  assert.deepEqual(calls,['verify','retrieve','verify']);
  assert.equal(plan.kind,'offline-signed-stripe-test-tax-finalization-plan');
  assert.equal(plan.eventId,event.id);
  assert.equal(plan.sessionId,session.id);
  assert.equal(plan.taxCents,95);
  assert.equal(plan.totalCents,2145);
  assert.equal(plan.nextOrderVersion,3);
  assert.equal(plan.executable,false);
  assert.equal(plan.checkoutEnabled,false);
  assert.equal(plan.settled,false);
  assert.equal(plan.orderStatus,'RESERVED');
  assert.equal(plan.paymentStatus,'PENDING');
  for(const f of ['paymentWriteAuthorized','stockWriteAuthorized','fulfillmentAuthorized'])
    assert.equal(plan[f],false);
  assert.equal(plan.update.TableName,TABLE);
  assert.deepEqual(plan.update.Key,{orderId:order.orderId});
  assert.match(plan.update.UpdateExpression,/#tax = :tax/);
  assert.match(plan.update.UpdateExpression,/#total = :total/);
  assert.match(plan.update.ConditionExpression,/attribute_type\(#tax, :nullType\)/);
  assert.match(plan.update.ConditionExpression,/attribute_type\(#total, :nullType\)/);
  assert.match(plan.update.ConditionExpression,/attribute_not_exists\(#paymentEvent\)/);
  assert.match(plan.update.ConditionExpression,/#digest = :digest/);
  assert.equal(plan.update.ExpressionAttributeValues[':version'],2);
  assert.equal(plan.update.ExpressionAttributeValues[':tax'],95);
  assert.equal(plan.update.ExpressionAttributeValues[':total'],2145);
  assert.equal(plan.update.ExpressionAttributeValues[':nullType'],'NULL');
  const persisted=JSON.stringify(plan);
  for(const field of ['22 Fictional Lane','98101','fake-local-hmac-key',
    'sk_test_','whsec_','payment_intent','pi_abcdefgh123456'])
    assert.equal(persisted.includes(field),false,field);
});
test('tampered signed body is rejected before Stripe SDK retrieval',async()=>{
  const trace=[];
  const request=signedRequest();
  await assert.rejects(()=>planFinalizeSignedStripeTestOrderTotals(args({
    request:{...request,body:request.body.replace('2145','2146')},
    stripeSdk:sdk(session,trace)
  })),/Signature/i);
  assert.deepEqual(trace,['verify']);
});
test('provider and signed webhook mismatch, live events and forged tax fail closed',async()=>{
  const providerBad=[
    {...session,id:'cs_test_other12345678'},
    {...session,livemode:true},
    {...session,status:'open'},
    {...session,payment_status:'unpaid'},
    {...session,amount_subtotal:1201},
    {...session,shipping_cost:{amount_total:849}},
    {...session,total_details:{amount_tax:96,amount_discount:0}},
    {...session,amount_total:2146},
    {...session,total_details:{amount_tax:95,amount_discount:1}},
    {...session,automatic_tax:{enabled:false,status:'complete'}},
    {...session,automatic_tax:{enabled:true,status:'requires_location_inputs'}},
    {...session,client_reference_id:'other-order'},
    {...session,metadata:{orderId:'other-order'}},
    {...session,payment_intent:null},
    {...session,collected_information:{shipping_details:{address:{...destination,line1:'55 Different Road'}}}}
  ];
  for(const item of providerBad)
    await assert.rejects(()=>planFinalizeSignedStripeTestOrderTotals(args({
      stripeSdk:sdk(item)
    })));
  const signedUnpaid={...event,data:{object:{...session,payment_status:'unpaid'}}};
  await assert.rejects(()=>planFinalizeSignedStripeTestOrderTotals(args({
    request:signedRequest(signedUnpaid),stripeSdk:sdk({...session,payment_status:'unpaid'})
  })),/paid/);
});
test('session-bound order cannot be retaxed after any payment or concurrent mutation',async()=>{
  for(const changed of [
    {taxCents:0},{totalCents:2145},{status:'PAID'},
    {paymentStatus:'PAID'}, {fulfillmentStatus:'SHIPPED'},
    {version:1}, {version:0}, {version:1.5},
    {paymentEventId:event.id},
    {paymentMode:'live'},{paymentSessionId:'cs_test_other12345678'},
    {stripeSessionId:'cs_test_other12345678'},
    {shippingAddressVerified:false},
    {shippingDestinationDigest:'invalid'},
    {shippingCountry:'CA'}, {pickupAvailable:true},
    {shippingCents:0},{subtotalCents:0}
  ])await assert.rejects(()=>planFinalizeSignedStripeTestOrderTotals(args({
    order:{...order,...changed}
  })));
});
test('late paid events and expired carrier quotes are refused instead of capturing stock',async()=>{
  for(const modified of [
    {reservedUntil:'2026-10-10T02:04:00Z'},
    {carrierQuoteExpiresAt:'2026-10-10T02:04:00Z'}
  ])await assert.rejects(()=>planFinalizeSignedStripeTestOrderTotals(args({
    order:{...order,...modified}
  })),/Expired/);
  await assert.rejects(()=>planFinalizeSignedStripeTestOrderTotals(args({
    checkedAt:'no date'
  })),/UTC/);
});
test('only standalone physical Orders V2 sandbox table can be finalized',async()=>{
  for(const other of [
    undefined,'hobbyhub-OrdersTable-PRODUCTION',
    'hobbyhub-InventoryTable-X2IRQDAGW7WB',
    'hobbyhub-checkout-v2-sandbox-foundation-StockV2-TEST12345',
    'hobbyhub-checkout-v2-sandbox-foundation-OrdersV2-*'
  ])await assert.rejects(()=>planFinalizeSignedStripeTestOrderTotals(args({
    orderTable:other
  })),/isolated/);
});
