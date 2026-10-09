import test from 'node:test';
import assert from 'node:assert/strict';
import {planVerifiedReservationSettlement} from '../backend/stock-reservation-settlement.mjs';

const order={
  orderId:'order-100',version:4,status:'RESERVED',paymentStatus:'PENDING',
  fulfillmentStatus:'UNFULFILLED',shippingCountry:'US',shippingMethod:'domestic_shipping',
  pickupAvailable:false,paymentSessionId:'cs_test_a123456789098765',
  subtotalCents:1500,shippingCents:500,taxCents:150,totalCents:2150,
  items:[{productId:'p-1',qty:2},{productId:'p-2',qty:1}]
};
const stocks=new Map([
  ['p-1',{productId:'p-1',onHand:10,reserved:5,version:8}],
  ['p-2',{productId:'p-2',onHand:2,reserved:1,version:3}]
]);
const evidence={provider:'stripe',eventId:'evt_a1234567890ab',
  sessionId:order.paymentSessionId,serverSignatureVerified:true,
  terminalState:'paid',paymentStatus:'paid',currency:'usd',amountPaidCents:2150};
const tables={stockTable:'TEST-STOCK',orderTable:'TEST-ORDERS',auditTable:'TEST-AUDIT'};
function plan(outcome='capture',options={}){
  return planVerifiedReservationSettlement({
    order,stockById:stocks,evidence,outcome,now:'2026-10-09T18:00:00Z',
    ...tables,...options
  });
}
test('capturing only verified paid reservation decrements on hand AND reserved atomically',()=>{
  const value=plan();
  assert.equal(value.executable,false);
  assert.equal(value.requiresSignedProviderWebhook,true);
  assert.equal(value.resultingStatus,'PAID');
  assert.equal(value.transactItems.length,4);
  assert.equal(value.transactItems[0].Update.Key.productId,'p-1');
  assert.match(value.transactItems[0].Update.UpdateExpression,/#onHand = #onHand - :qty/);
  assert.match(value.transactItems[0].Update.UpdateExpression,/#reserved = #reserved - :qty/);
  assert.equal(value.transactItems[0].Update.ExpressionAttributeValues[':reserved'],5);
  assert.equal(value.transactItems[0].Update.ExpressionAttributeValues[':version'],8);
  assert.match(value.transactItems[2].Update.ConditionExpression,/#status = :reserved/);
  assert.equal(value.transactItems[3].Put.Item.requestId,evidence.eventId);
  assert.equal(value.transactItems[3].Put.ConditionExpression,'attribute_not_exists(requestId)');
  assert.equal(value.orderChanges.paymentStatus,'PAID');
});
test('releasing a confirmed terminal failure preserves physical stock and unlocks units',()=>{
  const v=plan('release',{evidence:{...evidence,terminalState:'expired',paymentStatus:'unpaid'}});
  assert.equal(v.resultingStatus,'RELEASED');
  assert.equal(v.orderChanges.fulfillmentStatus,'CANCELLED');
  assert.doesNotMatch(v.transactItems[0].Update.UpdateExpression,/#onHand = #onHand - :qty/);
  assert.match(v.transactItems[0].Update.UpdateExpression,/#reserved = #reserved - :qty/);
  assert.equal(v.audit.operation,'reservation-release');
});
test('never capture without matching Stripe event, exact tax, currency and finalized amount',()=>{
  const invalid=[
    {...evidence,sessionId:'cs_test_differentsession'},
    {...evidence,serverSignatureVerified:false},
    {...evidence,eventId:'noevent'},
    {...evidence,currency:'cad'},
    {...evidence,amountPaidCents:2100},
    {...evidence,paymentStatus:'unpaid'},
    {...evidence,terminalState:'expired'}
  ];
  for(const x of invalid)assert.throws(()=>plan('capture',{evidence:x}));
  assert.throws(()=>plan('capture',{order:{...order,totalCents:null}}),/finalized/);
  assert.throws(()=>plan('capture',{order:{...order,taxCents:null}}),/finalized/);
});
test('never release a reservation based on a browser redirect or unverified expiry claim',()=>{
  assert.throws(()=>plan('release',{evidence:{...evidence,terminalState:'paid'}}),/terminal failures/);
  assert.throws(()=>plan('release',{evidence:{...evidence,terminalState:'expired',serverSignatureVerified:false}}),/Signed/);
  assert.throws(()=>plan('release',{evidence:{...evidence,terminalState:'expired',sessionId:'cs_test_otherstuff12345'}}),/Signed/);
});
test('block duplicate, under-reserved, missing, or stale stock state before forming atomic actions',()=>{
  assert.throws(()=>plan('capture',{stockById:new Map()}),/stock balance/);
  assert.throws(()=>plan('capture',{stockById:new Map([
    ['p-1',{productId:'p-1',onHand:10,reserved:1,version:8}],
    ['p-2',stocks.get('p-2')]
  ])}),/stock balance/);
  assert.throws(()=>plan('release',{order:{...order,items:[order.items[0],order.items[0]]},
    evidence:{...evidence,terminalState:'expired'}}),/duplicate/);
  assert.throws(()=>plan('capture',{order:{...order,status:'PAID'}}),/pending domestic/);
  assert.throws(()=>plan('capture',{order:{...order,shippingCountry:'CA'}}),/pending domestic/);
  assert.throws(()=>plan('capture',{order:{...order,pickupAvailable:true}}),/pending domestic/);
  assert.throws(()=>plan('capture',{order:{...order,fulfillmentStatus:'SHIPPED'}}),/pending domestic/);
});
test('plans contain no customer address, secrets, or executable payment actions',()=>{
  const v=plan();
  const serialized=JSON.stringify(v);
  assert.equal(serialized.includes('shippingAddress'),false);
  assert.equal(serialized.includes('customerEmail'),false);
  assert.equal(serialized.includes('stripeSignatureSecret'),false);
  assert.equal('stripeCheckoutSession' in v,false);
  assert.equal(v.executable,false);
});
