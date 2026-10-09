import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFulfillmentTransition,FULFILLMENT_ACTIONS} from '../backend/fulfillment-v2.mjs';

const requestId='7cf18d40-0a57-4f45-af9f-fb5d478cf5a0';
const paid={
  orderId:'order-1',paymentStatus:'PAID',status:'PAID',fulfillmentStatus:'UNFULFILLED',
  version:3,shippingCountry:'US',shippingMethod:'domestic_shipping',pickupAvailable:false,
  shippingAddressVerified:true,items:[{productId:'mtg-1',qty:1}],
};
function move(order,action,evidence={},now='2026-10-09T12:00:00Z'){
  return buildFulfillmentTransition(order,{
    action,expectedVersion:order.version,requestId,actorId:'admin-1',
    now,evidence,orderTable:'TEST-ORDERS',auditTable:'TEST-AUDIT'
  });
}
test('fulfillment flow requires paid US shipment, verified address and no pickup',()=>{
  assert.deepEqual(FULFILLMENT_ACTIONS,['START_PICKING','MARK_PACKED','MARK_SHIPPED','CONFIRM_DELIVERY']);
  const initial=move(paid,'START_PICKING');
  assert.equal(initial.from,'UNFULFILLED');
  assert.equal(initial.to,'PICKING');
  assert.equal(initial.nextVersion,4);
  assert.equal(initial.transaction.TransactItems.length,2);
  assert.deepEqual(initial.transaction.TransactItems[0].Update.Key,{orderId:'order-1'});
  assert.match(initial.transaction.TransactItems[0].Update.ConditionExpression,/#paymentStatus = :paid/);
  assert.match(initial.transaction.TransactItems[0].Update.ConditionExpression,/#addressVerified = :verified/);
  assert.equal(initial.audit.fromStatus,'UNFULFILLED');
  assert.equal('shippingAddress' in initial.audit,false);
  assert.equal('customerEmail' in initial.audit,false);
});
test('pending, unpaid, wrong version, international and pickup orders cannot enter picking',()=>{
  const changed=[
    {...paid,status:'RESERVED'},
    {...paid,paymentStatus:'PENDING'},
    {...paid,shippingCountry:'CA'},
    {...paid,shippingMethod:'local_pickup'},
    {...paid,pickupAvailable:true},
    {...paid,shippingAddressVerified:false},
    {...paid,items:[]}
  ];
  for(const row of changed)assert.throws(()=>move(row,'START_PICKING'));
  assert.throws(()=>buildFulfillmentTransition(paid,{
    action:'START_PICKING',expectedVersion:2,requestId,actorId:'admin-1',
    now:'2026-10-09T12:00:00Z',orderTable:'TEST-ORDERS',auditTable:'TEST-AUDIT'
  }),/version/);
});
test('fulfillment transitions cannot skip picking, packing, shipment or carrier-delivery evidence',()=>{
  assert.throws(()=>move(paid,'MARK_PACKED'),/expected fulfillment state/);
  assert.throws(()=>move(paid,'MARK_SHIPPED',{carrier:'USPS',trackingNumber:'TRACKING1234',labelPurchaseConfirmed:true}),/expected fulfillment state/);
  assert.throws(()=>move({...paid,fulfillmentStatus:'PICKING'},'CONFIRM_DELIVERY',{carrierDeliveryVerified:true}),/expected fulfillment state/);
  assert.throws(()=>move(paid,'CANCEL_ORDER'),/Unsupported/);
});
test('packing is allowed only after picking and rejects unrelated evidence',()=>{
  const order={...paid,fulfillmentStatus:'PICKING',version:4};
  const result=move(order,'MARK_PACKED');
  assert.equal(result.to,'PACKED');
  assert.throws(()=>move(order,'MARK_PACKED',{carrier:'UPS'}),/Extra fulfillment evidence/);
});
test('shipping requires an acknowledged purchased label and supported carrier/tracking',()=>{
  const order={...paid,fulfillmentStatus:'PACKED',version:5};
  assert.throws(()=>move(order,'MARK_SHIPPED'),/purchased label/);
  assert.throws(()=>move(order,'MARK_SHIPPED',{carrier:'USPS',trackingNumber:'TRACKING1234'}),/purchased label/);
  assert.throws(()=>move(order,'MARK_SHIPPED',{carrier:'BOGUS',trackingNumber:'TRACKING1234',labelPurchaseConfirmed:true}),/supported carrier/);
  assert.throws(()=>move(order,'MARK_SHIPPED',{carrier:'UPS',trackingNumber:'x',labelPurchaseConfirmed:true}),/tracking number/);
  const result=move(order,'MARK_SHIPPED',{carrier:'USPS',trackingNumber:'TRACKING1234',labelPurchaseConfirmed:true});
  assert.equal(result.to,'SHIPPED');
  assert.equal(result.changed.trackingNumber,'TRACKING1234');
  assert.equal(result.changed.carrier,'USPS');
  assert.ok(result.transaction.TransactItems[0].Update.UpdateExpression.includes('#trackingNumber = :trackingNumber'));
  assert.equal(result.audit.trackingNumber,'TRACKING1234');
});
test('delivery requires carrier-confirmed evidence and cannot predate shipment',()=>{
  const order={...paid,fulfillmentStatus:'SHIPPED',version:6,carrier:'USPS',
    trackingNumber:'TRACKING1234',shippedAt:'2026-10-09T12:00:00Z'};
  assert.throws(()=>move(order,'CONFIRM_DELIVERY',{},'2026-10-09T18:00:00Z'),/Carrier-confirmed/);
  assert.throws(()=>move(order,'CONFIRM_DELIVERY',{carrierDeliveryVerified:true},'2026-10-09T10:00:00Z'),/cannot precede/);
  const result=move(order,'CONFIRM_DELIVERY',{carrierDeliveryVerified:true},'2026-10-10T12:00:00Z');
  assert.equal(result.to,'DELIVERED');
  assert.equal(result.changed.deliveredAt,'2026-10-10T12:00:00Z');
});
test('audit event uses a separate table and idempotent request key',()=>{
  const result=move(paid,'START_PICKING');
  assert.equal(result.audit.requestId,requestId);
  assert.equal(result.audit.actorId,'admin-1');
  assert.equal(result.transaction.TransactItems[1].Put.TableName,'TEST-AUDIT');
  assert.equal(result.transaction.TransactItems[1].Put.ConditionExpression,'attribute_not_exists(requestId)');
  assert.throws(()=>buildFulfillmentTransition(paid,{
    action:'START_PICKING',expectedVersion:3,requestId:'bad',actorId:'admin-1',
    now:'2026-10-09T12:00:00Z',orderTable:'O',auditTable:'A'
  }),/idempotency/);
  assert.throws(()=>buildFulfillmentTransition(paid,{
    action:'START_PICKING',expectedVersion:3,requestId,actorId:'admin-1',
    now:'2026-10-09T12:00:00Z',orderTable:'S',auditTable:'S'
  }),/Separate verified/);
});
