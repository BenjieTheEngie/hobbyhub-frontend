import test from 'node:test';
import assert from 'node:assert/strict';
import {decideTestCheckoutEvent,proposeTestPaidTransaction} from '../backend/checkout-webhook-plan.mjs';

const order={
  orderId:'order-101',stripeSessionId:'cs_test_abcdef123456789',testMode:true,
  status:'RESERVED',paymentStatus:'PENDING',version:2,
  currency:'usd',totalCents:1975,
  shippingCountry:'US',shippingMethod:'domestic_shipping',pickupAvailable:false,
  reservedUntil:'2026-10-09T21:00:00Z',
  items:[{productId:'card-123',qty:1}]
};
const session={
  object:'checkout.session',id:order.stripeSessionId,livemode:false,
  metadata:{orderId:order.orderId},currency:'usd',amount_total:1975,
  payment_status:'paid',payment_intent:'pi_abcdef123456789'
};
const event={id:'evt_abcdef123456789',livemode:false,type:'checkout.session.completed',data:{object:session}};
const now='2026-10-09T20:00:00Z';
const decide=(e=event,o=order,opts={})=>decideTestCheckoutEvent({event:e,order:o,now,...opts});

test('only a trusted signature-verified matching test event can propose payment',()=>{
  assert.throws(()=>decide(event,order),/Signed Stripe/);
  const d=decide(event,order,{signatureVerified:true});
  assert.equal(d.action,'confirm-test-payment');
  assert.equal(d.writeAllowed,false);
  assert.equal(d.amountCents,1975);
  assert.equal(d.mode,'test');
});
test('wrong Stripe session or order, production event or wrong currency/amount are rejected',()=>{
  const good={signatureVerified:true};
  const failures=[
    [{...event,livemode:true},order],
    [{...event,data:{object:{...session,livemode:true}}},order],
    [{...event,data:{object:{...session,id:'cs_test_WRONG1234567'}}},order],
    [{...event,data:{object:{...session,metadata:{orderId:'other'}}}},order],
    [{...event,data:{object:{...session,currency:'cad'}}},order],
    [{...event,data:{object:{...session,amount_total:1}}},order],
    [event,{...order,totalCents:null}],
    [event,{...order,shippingCountry:'CA'}],
    [event,{...order,pickupAvailable:true}],
    [event,{...order,testMode:false}],
  ];
  for(const [badEvent,badOrder] of failures)assert.throws(()=>decide(badEvent,badOrder,good));
});
test('browser redirect and unpaid completion cannot trigger successful payment',()=>{
  const pending={...event,data:{object:{...session,payment_status:'unpaid'}}};
  assert.equal(decide(pending,order,{signatureVerified:true}).action,'wait-for-payment');
  assert.equal(decide(pending,order,{signatureVerified:true}).writeAllowed,false);
  assert.equal(decide(event,{...order,paymentStatus:'PAID',status:'PAID'}, {signatureVerified:true}).action,'review-existing-order');
});
test('expired/late webhook never automatically releases stock or approves fulfillment',()=>{
  const expired={...event,type:'checkout.session.expired'};
  const expiredDecision=decide(expired,order,{signatureVerified:true});
  assert.equal(expiredDecision.action,'reconciliation-required');
  assert.equal(expiredDecision.writeAllowed,false);
  const late=decide(event,{...order,reservedUntil:'2026-10-09T19:00:00Z'}, {signatureVerified:true});
  assert.equal(late.action,'reconciliation-required');
  assert.equal(late.writeAllowed,false);
});
test('test-mode PAID proposal is inert and uses conditional order+unique event atomically',()=>{
  const d=decide(event,order,{signatureVerified:true});
  const p=proposeTestPaidTransaction(d,{orderTable:'TEST-CUSTOMER-ORDERS',eventTable:'TEST-STRIPE-EVENTS'});
  assert.equal(p.executable,false);
  assert.equal(p.requiresOwnerApproval,true);
  assert.equal(p.requiresStripeSignatureVerification,true);
  assert.equal(p.transaction.TransactItems.length,2);
  const update=p.transaction.TransactItems[0].Update;
  assert.deepEqual(update.Key,{orderId:'order-101'});
  assert.match(update.ConditionExpression,/#totalCents = :total/);
  assert.match(update.ConditionExpression,/#stripeSessionId = :session/);
  assert.match(update.ConditionExpression,/#version = :expected/);
  assert.equal(update.ExpressionAttributeValues[':total'],1975);
  assert.equal(update.ExpressionAttributeValues[':paid'],'PAID');
  const audit=p.transaction.TransactItems[1].Put;
  assert.equal(audit.ConditionExpression,'attribute_not_exists(eventId)');
  assert.equal(audit.Item.eventId,event.id);
  assert.equal(audit.Item.mode,'test');
  assert.equal('email' in audit.Item,false);
  assert.equal('shippingAddress' in audit.Item,false);
  assert.equal(JSON.stringify(p).includes('StripeSecret'),false);
});
test('invalid decisions or shared order/event table cannot construct a transaction',()=>{
  assert.throws(()=>proposeTestPaidTransaction({action:'wait-for-payment',writeAllowed:false,mode:'test'},{
    orderTable:'T',eventTable:'E'
  }),/non-executable/);
  const d=decide(event,order,{signatureVerified:true});
  assert.throws(()=>proposeTestPaidTransaction(d,{orderTable:'T',eventTable:'T'}),/separate tables/);
});
