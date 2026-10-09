import test from 'node:test';
import assert from 'node:assert/strict';
import {auditStripeSandboxSessionTotals} from '../backend/stripe-test-session-total-audit.mjs';

const order={
  orderId:'order-verified-01',stripeSessionId:'cs_test_abcdefghijkl',
  paymentMode:'test',version:5,status:'RESERVED',paymentStatus:'PENDING',
  fulfillmentStatus:'UNFULFILLED',currency:'usd',shippingCountry:'US',
  shippingMethod:'domestic_shipping',pickupAvailable:false,
  shippingAddressVerified:true,shippingState:'MA',
  subtotalCents:1500,shippingCents:499,taxCents:126,totalCents:2125,
  reservedUntil:'2026-10-09T21:00:00Z',
  items:[{productId:'immutable-1',sku:'MTG-X',qty:2,unitPriceCents:750,lineTotalCents:1500}]
};
const session={
  object:'checkout.session',id:order.stripeSessionId,livemode:false,
  mode:'payment',client_reference_id:order.orderId,metadata:{orderId:order.orderId},
  currency:'usd',amount_subtotal:1500,amount_total:2125,
  shipping_cost:{amount_total:499},
  total_details:{amount_tax:126,amount_discount:0},
  automatic_tax:{enabled:true,status:'complete'},
  status:'complete',payment_status:'paid',payment_intent:'pi_abcdefghijkl',
  collected_information:{shipping_details:{address:{country:'US',state:'MA',postal_code:'02382',
    line1:'DO_NOT_EXPORT_CUSTOMER_ADDRESS'}}}
};
const when='2026-10-09T20:00:00Z';
const audit=(s=session,o=order,at=when)=>auditStripeSandboxSessionTotals({session:s,order:o,checkedAt:at});
test('matched test payment requires atomic signed-event reconciliation and never authorizes fulfillment',()=>{
  const result=audit();
  assert.deepEqual(result,{
    orderId:order.orderId,sessionId:session.id,expectedOrderVersion:5,amountCents:2125,
    disposition:'MATCHED_TEST_PAYMENT_REQUIRES_ATOMIC_RECONCILIATION',
    paymentWriteAuthorized:false,stockWriteAuthorized:false,
    fulfillmentAuthorized:false,checkoutEnabled:false,
    requiresDurableSignedEventLedger:true,requiresAtomicStockSettlement:true
  });
  assert.equal(JSON.stringify(result).includes('DO_NOT_EXPORT_CUSTOMER_ADDRESS'),false);
});
test('late paid, expired unpaid, and completed unpaid do not allow shipment or stock release',()=>{
  assert.equal(audit(session,order,'2026-10-09T21:00:01Z').disposition,'LATE_PAYMENT_REQUIRES_REVIEW');
  assert.equal(audit({...session,status:'expired',payment_status:'unpaid',payment_intent:null}).disposition,'REVIEW_EXPIRED_SESSION_BEFORE_STOCK_RELEASE');
  assert.equal(audit({...session,payment_status:'unpaid',payment_intent:null}).disposition,'AWAIT_PROVIDER_PAYMENT');
  assert.equal(audit({...session,status:'open',payment_status:'paid'}).disposition,'REVIEW_PROVIDER_STATE_MISMATCH');
});
test('rejects swapped session/order, live mode, mismatched USD currency and unsupported payment mode',()=>{
  const mutated=[
    {...session,id:'cs_test_otherother12345'},
    {...session,client_reference_id:'another-order'},
    {...session,metadata:{orderId:'another-order'}},
    {...session,livemode:true},{...session,currency:'cad'},
    {...session,mode:'subscription'}
  ];
  for(const x of mutated)assert.throws(()=>audit(x));
  assert.throws(()=>audit(session,{...order,paymentMode:'live'}));
  assert.throws(()=>audit(session,{...order,shippingAddressVerified:false}));
  assert.throws(()=>audit(session,{...order,pickupAvailable:true}));
  assert.throws(()=>audit(session,{...order,version:0}));
  assert.throws(()=>audit(session,{...order,status:'PAID',paymentStatus:'PAID'}));
});
test('each Stripe financial component, not just the final amount, must exactly match the server snapshot',()=>{
  const changes=[
    {...session,amount_subtotal:1400},
    {...session,shipping_cost:{amount_total:599}},
    {...session,total_details:{amount_tax:225,amount_discount:0}},
    {...session,total_details:{amount_tax:126,amount_discount:100}},
    {...session,amount_total:2126},
    {...session,shipping_cost:null},
    {...session,total_details:null},
    {...session,amount_subtotal:1500.5}
  ];
  for(const x of changes)assert.throws(()=>audit(x));
  assert.throws(()=>audit(session,{...order,subtotalCents:1400}),/do not add up|subtotal/);
  assert.throws(()=>audit(session,{...order,totalCents:2124}),/do not add up/);
  assert.throws(()=>audit(session,{...order,items:[{...order.items[0],lineTotalCents:1499}]}),/subtotal/);
});
test('Stripe Tax must be enabled and completed; fabricated or missing tax is not accepted',()=>{
  for(const x of [
    {...session,automatic_tax:{enabled:false,status:'complete'}},
    {...session,automatic_tax:{enabled:true,status:'failed'}},
    {...session,automatic_tax:null}
  ])assert.throws(()=>audit(x),/automatic tax/);
  assert.throws(()=>audit(session,{...order,taxCents:null}),/order tax/);
});
test('shipping must match approved 50-state+DC destination and unchanged order state',()=>{
  const addr=session.collected_information.shipping_details.address;
  for(const state of ['PR','GU','AA','AE','AP','xx']){
    const bad={...session,collected_information:{shipping_details:{address:{...addr,state}}}};
    assert.throws(()=>audit(bad),/50 states/);
  }
  assert.throws(()=>audit({...session,collected_information:{shipping_details:{address:{...addr,country:'CA'}}}}),/50 states/);
  assert.throws(()=>audit({...session,collected_information:{shipping_details:{address:{...addr,postal_code:'not-a-zip'}}}}),/50 states/);
  assert.throws(()=>audit({...session,collected_information:{shipping_details:{address:{...addr,state:'NY'}}}}),/destination changed/);
  assert.throws(()=>audit(session,{...order,shippingState:'NY'}),/destination changed/);
  assert.equal(audit({...session,collected_information:undefined,shipping_details:{address:addr}}).amountCents,2125);
});
test('rejects missing payment intent, amount out of bounds, bad order line identity and invalid timestamps',()=>{
  assert.throws(()=>audit({...session,payment_intent:null}),/payment-intent/);
  assert.throws(()=>audit({...session,payment_status:'no_payment_required'}),/payment state/);
  assert.throws(()=>audit({...session,amount_total:NaN}),/integer USD cents/);
  assert.throws(()=>audit(session,{...order,items:[]}),/line items/);
  assert.throws(()=>audit(session,{...order,items:[order.items[0],order.items[0]]}),/identity/);
  assert.throws(()=>audit(session,order,'tomorrow'),/timestamp/);
  assert.throws(()=>audit(session,{...order,reservedUntil:null}),/timestamp/);
});
