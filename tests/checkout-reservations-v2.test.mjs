import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIdempotentReservationPlan,verifyIdempotentReservationReplay,
  buildExpiredReservationReleasePlan
} from '../backend/checkout-reservations-v2.mjs';
import {verifyCheckoutQuote,validateCheckoutIntent} from '../backend/checkout-v2-core.mjs';
import {quoteDomesticShipping,composePrecheckoutTotals} from '../backend/shipping-v2.mjs';

const requestId='7cf18d40-0a57-4f45-af9f-fb5d478cf5a0';
const releaseId='c40b691b-2341-4e0f-8ff3-cf6fc392760c';
const now='2026-10-09T18:00:00Z';
const expires='2026-10-09T18:30:00Z';
const addr={recipient:'Demo',line1:'1 Sample Street',city:'Boston',state:'MA',postalCode:'02110',country:'US'};
const rates={method:'domestic_shipping',country:'US',pickupEnabled:false,approved:true,
  ratesCents:{contiguous:800,alaska:1800,hawaii:1900}}; // fixtures, never production rates
function quote(){
  const intent=validateCheckoutIntent({requestId,items:[{productId:'p1',qty:2}]});
  const priced=verifyCheckoutQuote(intent,{
    productsById:new Map([['p1',{productId:'p1',sku:'MTG-TEST-001',
      productName:'Test cards',published:true,salePrice:4}]]),
    stockById:new Map([['p1',{productId:'p1',onHand:6,reserved:1,version:3}]]),
    skuCounts:new Map([['mtg-test-001',1]])
  });
  return composePrecheckoutTotals(priced,quoteDomesticShipping(addr,rates));
}
function reserve(overrides={}){
  return buildIdempotentReservationPlan(quote(),{
    stockTable:'TESTSTOCK',orderTable:'TESTORDERS',idempotencyTable:'TESTREQUESTS',
    orderId:'order-1',now,holdUntil:expires,...overrides
  });
}
const evidence={provider:'stripe',mode:'test',paymentSessionExpiredVerified:true,
  noCapturedPaymentVerified:true,eventId:'evt_testsession01234',
  providerCheckedAt:'2026-10-09T19:00:00Z'};
function expire(order,opts={}){
  return buildExpiredReservationReleasePlan(order,new Map([['p1',{
    productId:'p1',onHand:6,reserved:3,version:4
  }]]),{
    stockTable:'TESTSTOCK',orderTable:'TESTORDERS',auditTable:'TESTAUDIT',
    requestId:releaseId,now:'2026-10-09T19:00:00Z',evidence,...opts
  });
}
test('reserve plan includes a distinct conditional checkout request ledger and no side effects',()=>{
  const result=reserve();
  assert.equal(result.executable,false);
  assert.equal(result.paymentReady,false);
  assert.equal(result.order.paymentStatus,'PENDING');
  assert.equal(result.order.totalCents,null);
  assert.equal(result.transactItems.length,3);
  const ledgerPut=result.transactItems.at(-1).Put;
  assert.equal(ledgerPut.TableName,'TESTREQUESTS');
  assert.equal(ledgerPut.Item.orderId,'order-1');
  assert.equal(ledgerPut.Item.requestId,requestId);
  assert.match(ledgerPut.Item.quoteHash,/^[0-9a-f]{64}$/);
  assert.equal(ledgerPut.ConditionExpression,'attribute_not_exists(requestId)');
  assert.equal('ttl' in ledgerPut.Item,false);
});
test('same request cannot become new order, altered cart, or changed shipping quote',()=>{
  const plan=reserve();
  assert.deepEqual(verifyIdempotentReservationReplay(plan.ledger,plan),{
    sameRequest:true,createNewReservation:false,verifiedOrderId:'order-1'
  });
  assert.throws(()=>verifyIdempotentReservationReplay(
    {...plan.ledger,orderId:'order-2'},plan),/conflicting/);
  assert.throws(()=>verifyIdempotentReservationReplay(
    {...plan.ledger,quoteHash:'wrong'},plan),/conflicting/);
  assert.throws(()=>reserve({idempotencyTable:'TESTORDERS'}),/Three separate/);
});
test('release never runs on pending, paid, unexpired, pickup or international orders',()=>{
  const order=reserve().order;
  assert.throws(()=>expire({...order,status:'PAID',paymentStatus:'PAID'}),/unpaid/);
  assert.throws(()=>expire({...order,paymentStatus:'PAID'}),/unpaid/);
  assert.throws(()=>expire({...order,shippingCountry:'CA'}),/domestic/);
  assert.throws(()=>expire({...order,pickupAvailable:true}),/domestic/);
  assert.throws(()=>expire({...order,fulfillmentStatus:'SHIPPED'}),/domestic/);
  assert.throws(()=>expire(order,{now:'2026-10-09T18:15:00Z',evidence:{...evidence,providerCheckedAt:'2026-10-09T18:15:00Z'}}),/not expired/);
  assert.throws(()=>expire(order,{evidence:{...evidence,provider:'other'}}),/expiry/);
  assert.throws(()=>expire(order,{evidence:{...evidence,noCapturedPaymentVerified:false}}),/expiry/);
  assert.throws(()=>expire(order,{evidence:{...evidence,mode:'live'}}),/expiry/);
});
test('release proposal is one atomic stock decrement plus versioned order expiry and audit',()=>{
  const order=reserve().order;
  const plan=expire(order);
  assert.equal(plan.executable,false);
  assert.equal(plan.requiresSignedProviderVerification,true);
  assert.equal(plan.transactItems.length,3);
  const stockUpdate=plan.transactItems[0].Update;
  assert.deepEqual(stockUpdate.Key,{productId:'p1'});
  assert.equal(stockUpdate.ExpressionAttributeValues[':qty'],2);
  assert.match(stockUpdate.ConditionExpression,/#reserved >= :qty/);
  assert.equal(stockUpdate.ExpressionAttributeValues[':expected'],4);
  const orderUpdate=plan.transactItems[1].Update;
  assert.equal(orderUpdate.ExpressionAttributeValues[':expired'],'EXPIRED');
  assert.equal(orderUpdate.ExpressionAttributeValues[':version'],order.version);
  assert.match(orderUpdate.ConditionExpression,/#status = :reserved/);
  assert.equal(plan.transactItems[2].Put.Item.operation,'expire-reservation');
  assert.equal(plan.transactItems[2].Put.ConditionExpression,'attribute_not_exists(requestId)');
});
test('release refuses unverified or insufficient reserved stock',()=>{
  const order=reserve().order;
  for(const bad of [
    {productId:'p1',onHand:6,reserved:1,version:4},
    {productId:'p1',onHand:6,reserved:7,version:4},
    {productId:'p1',onHand:6,reserved:3,version:null}
  ]){
    assert.throws(()=>buildExpiredReservationReleasePlan(order,new Map([['p1',bad]]),{
      stockTable:'TESTSTOCK',orderTable:'TESTORDERS',auditTable:'TESTAUDIT',
      requestId:releaseId,now:'2026-10-09T19:00:00Z',evidence
    }),/Unverified stock/);
  }
});
test('release requires trusted event key and separated table identities',()=>{
  const order=reserve().order;
  assert.throws(()=>expire(order,{requestId:'invalid'}),/idempotency/);
  assert.throws(()=>expire(order,{auditTable:'TESTSTOCK'}),/Three separate/);
  assert.throws(()=>expire(order,{evidence:{...evidence,eventId:'invalid'}}),/expiry/);
});
