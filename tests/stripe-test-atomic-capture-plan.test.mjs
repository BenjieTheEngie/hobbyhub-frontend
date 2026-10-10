import test from 'node:test';
import assert from 'node:assert/strict';
import {planStripeTestAtomicCapture} from '../backend/stripe-test-atomic-capture-plan.mjs';

const tables={
  stockTable:'hobbyhub-checkout-v2-sandbox-foundation-StockV2-TEST12345',
  orderTable:'hobbyhub-checkout-v2-sandbox-foundation-OrdersV2-TEST12345',
  eventTable:'hobbyhub-stripe-sandbox-ledgers-StripeTestEventLedger-1TS67SSV8ILV5'
};
const now='2026-10-10T02:05:00Z';
const fingerprint='a'.repeat(64);
const review={
  kind:'stripe-test-v2-inert-reconciliation',
  eventId:'evt_abcdefgh123456',sessionId:'cs_test_abcdefgh123456',
  orderId:'order-123',fingerprint,
  disposition:'RECONCILE_PAID_AND_STOCK_ATOMICALLY',
  totalAuditDisposition:'MATCHED_TEST_PAYMENT_REQUIRES_ATOMIC_RECONCILIATION',
  pendingAtomicSettlement:true,requiresHumanReview:false,duplicateEvent:false,
  executable:false,paymentWriteAuthorized:false,stockWriteAuthorized:false,
  fulfillmentAuthorized:false,paymentCollectionEnabled:false
};
const eventRow={
  eventId:review.eventId,orderId:review.orderId,sessionId:review.sessionId,
  schemaVersion:1,provider:'stripe',mode:'test',state:'PENDING_REVIEW',
  fingerprint,reviewDisposition:review.disposition,
  totalAuditDisposition:review.totalAuditDisposition,
  recordedAt:'2026-10-10T02:00:00Z'
};
const order={
  orderId:review.orderId,version:2,status:'RESERVED',paymentStatus:'PENDING',
  fulfillmentStatus:'UNFULFILLED',
  stripeSessionId:review.sessionId,paymentSessionId:review.sessionId,paymentMode:'test',
  shippingCountry:'US',shippingMethod:'domestic_shipping',pickupAvailable:false,
  shippingAddressVerified:true,currency:'usd',
  reservedUntil:'2026-10-10T02:30:00Z',
  totalCents:1898,taxCents:99,subtotalCents:1200,shippingCents:599,
  items:[{productId:'physical-123',qty:2,unitPriceCents:600,lineTotalCents:1200}]
};
const stockById=new Map([
  ['physical-123',{productId:'physical-123',version:5,onHand:10,reserved:3}]
]);
const args=(x={})=>({review,eventRow,order,stockById,now,...tables,...x});
test('generates ONE non-executable transaction with stock+order+existing event receipt transitions',()=>{
  const plan=planStripeTestAtomicCapture(args());
  assert.equal(plan.kind,'offline-stripe-test-atomic-capture-plan');
  assert.equal(plan.executable,false);
  assert.equal(plan.checkoutEnabled,false);
  assert.equal(plan.paymentEvidenceMustBeReverified,true);
  for(const field of ['paymentWriteAuthorized','stockWriteAuthorized','fulfillmentAuthorized'])
    assert.equal(plan[field],false);
  assert.equal(plan.targetOrderStatus,'PAID');
  assert.equal(plan.targetEventState,'SETTLED');
  assert.equal(plan.expectedOrderVersion,2);
  assert.equal(plan.transactItems.length,3);
  assert.ok(plan.transactItems.every(row=>row.Update&&!row.Put),'Never include a separate requestId-keyed Put');
  const [stock,orderUpdate,eventUpdate]=plan.transactItems.map(x=>x.Update);
  assert.equal(stock.TableName,tables.stockTable);
  assert.deepEqual(stock.Key,{productId:'physical-123'});
  assert.match(stock.UpdateExpression,/#onHand = #onHand - :qty/);
  assert.match(stock.UpdateExpression,/#reserved = #reserved - :qty/);
  assert.match(stock.ConditionExpression,/#version = :version/);
  assert.equal(orderUpdate.TableName,tables.orderTable);
  assert.deepEqual(orderUpdate.Key,{orderId:order.orderId});
  assert.match(orderUpdate.ConditionExpression,/#status = :reserved/);
  assert.match(orderUpdate.ConditionExpression,/#payment = :pending/);
  assert.equal(orderUpdate.ExpressionAttributeValues[':eventId'],review.eventId);
  assert.equal(eventUpdate.TableName,tables.eventTable);
  assert.deepEqual(eventUpdate.Key,{eventId:review.eventId});
  assert.match(eventUpdate.UpdateExpression,/#state = :settled/);
  assert.match(eventUpdate.ConditionExpression,/#state = :pending/);
  assert.match(eventUpdate.ConditionExpression,/#fingerprint = :fingerprint/);
  assert.match(eventUpdate.ConditionExpression,/#sessionId = :sessionId/);
  assert.equal(eventUpdate.ExpressionAttributeValues[':pending'],'PENDING_REVIEW');
  assert.equal(eventUpdate.ExpressionAttributeValues[':settled'],'SETTLED');
  assert.equal(eventUpdate.ExpressionAttributeValues[':nextOrderVersion'],3);
  assert.equal(eventUpdate.ExpressionAttributeValues[':fingerprint'],fingerprint);
  assert.doesNotMatch(JSON.stringify(plan),/whsec_|sk_test_|customerEmail|shippingAddress|123 Test Street/);
});
test('paid events with missing proof, duplicates, mismatched order or stale receipt fail closed',()=>{
  const bad=[
    {review:{...review,pendingAtomicSettlement:false}},
    {review:{...review,duplicateEvent:true}},
    {review:{...review,requiresHumanReview:true}},
    {review:{...review,disposition:'WAIT_FOR_VERIFIED_PAYMENT'}},
    {review:{...review,paymentCollectionEnabled:true}},
    {review:{...review,eventId:'evt_wrongid1234567'}},
    {review:{...review,fingerprint:'0'.repeat(64)}},
    {eventRow:{...eventRow,state:'SETTLED'}},
    {eventRow:{...eventRow,state:'UNVERIFIED'}},
    {eventRow:{...eventRow,mode:'live'}},
    {eventRow:{...eventRow,fingerprint:'b'.repeat(64)}},
    {eventRow:{...eventRow,sessionId:'cs_test_different987654'}},
    {order:{...order,paymentMode:'live'}},
    {order:{...order,shippingAddressVerified:false}},
    {order:{...order,shippingCountry:'CA'}},
    {order:{...order,stripeSessionId:'cs_test_different987654'}},
    {order:{...order,paymentSessionId:'cs_test_different987654'}},
    {order:{...order,status:'PAID'}},
    {order:{...order,paymentStatus:'PAID'}},
    {order:{...order,totalCents:null}}
  ];
  for(const change of bad)
    assert.throws(()=>planStripeTestAtomicCapture(args(change)),'Must reject malformed verified payment snapshot');
});
test('paid event after reservation expiry and malformed clock cannot capture stock',()=>{
  assert.throws(()=>planStripeTestAtomicCapture(args({now:'2026-10-10T02:30:01Z'})),/Expired/);
  assert.throws(()=>planStripeTestAtomicCapture(args({now:'2026-10-10T01:59:59Z'})),/predate/);
  assert.throws(()=>planStripeTestAtomicCapture(args({now:'malformed'})),/timestamp/);
  assert.throws(()=>planStripeTestAtomicCapture(args({eventRow:{...eventRow,recordedAt:'invalid'}})),/predate/);
});
test('missing or mismatched strongly consistent stock snapshots and duplicate physical products block capture',()=>{
  assert.throws(()=>planStripeTestAtomicCapture(args({stockById:new Map()})),/stock balance/);
  assert.throws(()=>planStripeTestAtomicCapture(args({stockById:new Map([[
    'physical-123',{productId:'physical-123',version:5,onHand:10,reserved:1}
  ]])})),/stock balance/);
  assert.throws(()=>planStripeTestAtomicCapture(args({order:{
    ...order,items:[order.items[0],order.items[0]]
  }})),/duplicate/);
});
test('original inventory, request ledger, other regions and wildcard tables cannot enter settlement',()=>{
  const badTables=[
    {stockTable:'hobbyhub-InventoryTable-X2IRQDAGW7WB'},
    {stockTable:'hobbyhub-checkout-v2-sandbox-foundation-StockV2-*'},
    {orderTable:'hobbyhub-ProductsTable-KC31XDEOENBG'},
    {orderTable:'hobbyhub-checkout-v2-sandbox-foundation-StockV2-TEST12345'},
    {eventTable:'hobbyhub-stripe-sandbox-ledgers-StripeTestCheckoutRequestLedger-12OAC8XV01K6S'},
    {eventTable:'hobbyhub-stripe-sandbox-ledgers-StripeTestEventLedger-*'}
  ];
  for(const bad of badTables)
    assert.throws(()=>planStripeTestAtomicCapture(args(bad)),/staging tables/);
});
