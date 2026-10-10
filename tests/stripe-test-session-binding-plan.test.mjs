import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {validateCheckoutIntent,verifyCheckoutQuote} from '../backend/checkout-v2-core.mjs';
import {parcelsForVerifiedCart} from '../backend/carrier-rating-v2.mjs';
import {composeOfflineLiveCarrierCommitment} from '../backend/carrier-live-commitment-offline.mjs';
import {buildIdempotentReservationPlan} from '../backend/checkout-reservations-v2.mjs';
import {planBindStripeTestCheckoutSession} from '../backend/stripe-test-session-binding-plan.mjs';

const TABLE='hobbyhub-checkout-v2-sandbox-foundation-OrdersV2-TEST12345';
const now='2026-10-10T02:01:00Z';
const hold='2026-10-10T02:30:00Z';
const addr={recipient:'Test Customer',line1:'22 Fictional Lane',
  city:'Seattle',state:'WA',postalCode:'98101',country:'US'};
const packageData={lengthIn:8,widthIn:5,heightIn:1,weightOz:6};
const product={productId:'physical-123',sku:'TEST-MTG-1',salePrice:6,
  productName:'Demo card box',status:'ACTIVE',published:true,
  shippingPackage:packageData};
const intent=validateCheckoutIntent({requestId:'7cf18d40-0a57-4f45-af9f-fb5d478cf5a0',
  items:[{productId:product.productId,qty:2}]});
function buildOrder(){
  const products=new Map([[product.productId,product]]);
  const quote=verifyCheckoutQuote(intent,{
    productsById:products,
    stockById:new Map([[product.productId,{productId:product.productId,
      onHand:9,reserved:1,version:4}]]),
    skuCounts:new Map([['test-mtg-1',1]])
  });
  const packed=parcelsForVerifiedCart(intent,products);
  const selectedRates=[
    {productId:product.productId,unit:1,provider:'easypost',mode:'live',
      carrier:'USPS',service:'GroundAdvantage',currency:'usd',
      rateId:'rate_abcdefgh123456',shippingCents:450},
    {productId:product.productId,unit:2,provider:'easypost',mode:'live',
      carrier:'USPS',service:'GroundAdvantage',currency:'usd',
      rateId:'rate_qwertyuiop123456',shippingCents:400}
  ];
  const carrier=composeOfflineLiveCarrierCommitment({
    productQuote:quote,measuredParcels:packed,selectedRates,
    destination:addr,
    destinationSigningKey:Buffer.from('dummy-local-test-key-32-chars-and-some-more'),
    addressDeliverabilityVerified:true,
    checkedAt:'2026-10-10T02:00:00Z',holdUntil:hold,
    carrierQuoteExpiresAt:'2026-10-10T03:00:00Z'
  });
  return buildIdempotentReservationPlan(carrier,{
    stockTable:'TEST_STOCK_V2',orderTable:TABLE,
    idempotencyTable:'TEST_REQUEST_LEDGER',
    orderId:'order-123',now:'2026-10-10T02:00:00Z',holdUntil:hold
  }).order;
}
const baseOrder=buildOrder();
const session={
  object:'checkout.session',id:'cs_test_abcdefgh123456',livemode:false,
  mode:'payment',client_reference_id:baseOrder.orderId,
  metadata:{orderId:baseOrder.orderId},currency:'usd',
  status:'open',payment_status:'unpaid',amount_subtotal:baseOrder.subtotalCents,
  shipping_cost:{amount_total:baseOrder.shippingCents},
  automatic_tax:{enabled:true,status:'requires_location_inputs'},
  total_details:null,amount_total:null
};
const plan=(x={})=>planBindStripeTestCheckoutSession({
  order:baseOrder,retrievedSession:session,
  orderTable:TABLE,now,...x
});
test('source-only pending Order V2 session binding plans one atomic versioned Update, never a paid transaction',()=>{
  assert.equal(baseOrder.version,1);
  assert.equal(baseOrder.shippingState,'WA');
  assert.equal(baseOrder.shippingAddressVerified,true);
  assert.equal(baseOrder.totalCents,null);
  assert.equal(baseOrder.taxCents,null);
  assert.equal(baseOrder.paymentSessionId,undefined);
  const p=plan();
  assert.equal(p.kind,'offline-stripe-test-session-binding-plan');
  assert.equal(p.executable,false);
  assert.equal(p.checkoutEnabled,false);
  for(const k of ['paymentWriteAuthorized','stockWriteAuthorized','fulfillmentAuthorized'])
    assert.equal(p[k],false);
  assert.equal(p.sessionId,session.id);
  assert.equal(p.nextOrderVersion,2);
  assert.equal(p.requiresSignedWebhook,true);
  assert.equal(p.taxFinalized,false);
  assert.equal(p.amountFinalized,false);
  assert.equal(p.update.TableName,TABLE);
  assert.deepEqual(p.update.Key,{orderId:baseOrder.orderId});
  assert.match(p.update.UpdateExpression,/#stripe = :session/);
  assert.match(p.update.UpdateExpression,/#paymentSession = :session/);
  assert.match(p.update.ConditionExpression,/attribute_not_exists\(#stripe\)/);
  assert.match(p.update.ConditionExpression,/attribute_not_exists\(#paymentSession\)/);
  assert.match(p.update.ConditionExpression,/#version = :version/);
  assert.match(p.update.ConditionExpression,/#digest = :digest/);
  assert.equal(p.update.ExpressionAttributeValues[':test'],'test');
  assert.equal(p.update.ExpressionAttributeValues[':version'],1);
  assert.equal(p.update.ExpressionAttributeValues[':shipping'],850);
  const result=JSON.stringify(p);
  for(const sensitive of ['22 Fictional Lane','98101','customerEmail',
    'sk_test_','whsec_','shippingAddress'])
    assert.equal(result.includes(sensitive),false,'Unexpected PII/secret: '+sensitive);
  assert.doesNotMatch(p.update.UpdateExpression,/PAID|totalCents|taxCents|fulfillmentStatus/);
});
test('cannot change Stripe TEST session identity or bind twice',()=>{
  for(const bad of [
    {stripeSessionId:session.id},
    {paymentSessionId:session.id},
    {paymentMode:'test'},
    {status:'PAID'},
    {paymentStatus:'PAID'},
    {fulfillmentStatus:'CANCELLED'},
    {version:0}, {version:1.2},
    {totalCents:1800},{taxCents:0},
    {shippingAddressVerified:false},
    {shippingDestinationDigest:'invalid'},
    {shippingState:null},
    {rateMode:'test'},
    {rateProvider:'unknown'},
    {paymentMode:'live'}
  ])assert.throws(()=>plan({order:{...baseOrder,...bad}}));
});
test('rejects live, paid, expired, wrong order, different shipping or incomplete test provider Sessions',()=>{
  for(const bad of [
    {livemode:true},
    {id:'cs_live_abcdefgh123456'},
    {id:'cs_test_bad'},
    {status:'complete'},
    {status:'expired'},
    {payment_status:'paid'},
    {mode:'subscription'},
    {currency:'eur'},
    {client_reference_id:'wrong-order'},
    {metadata:{orderId:'wrong-order'}},
    {amount_subtotal:1201},
    {shipping_cost:{amount_total:851}},
    {automatic_tax:{enabled:false}},
    {object:'invoice'}
  ])assert.throws(()=>plan({retrievedSession:{...session,...bad}}),/Stripe TEST Session/);
});
test('invalid or expired carrier holds block binding the session',()=>{
  for(const bad of [
    {reservedUntil:'2026-10-10T01:59:59Z'},
    {carrierQuoteExpiresAt:'2026-10-10T02:25:00Z'},
    {carrierQuoteExpiresAt:'invalid'},
    {carrierRateIds:[]},
    {carrierRateIds:['rate_abcdefgh123456','rate_abcdefgh123456']},
    {carrierRateDetails:[
      {...baseOrder.carrierRateDetails[0],shippingCents:500},
      baseOrder.carrierRateDetails[1]
    ]},
    {shippingCents:0},
    {subtotalCents:0},
    {items:[{...baseOrder.items[0],qty:3}]}
  ])assert.throws(()=>plan({order:{...baseOrder,...bad}}));
  assert.throws(()=>plan({now:'invalid'}),/UTC/);
  assert.throws(()=>plan({now:'2026-10-10T03:30:00Z'}),/unexpired/);
});
test('only isolated sandbox Orders V2 table is accepted',()=>{
  for(const name of [
    undefined,'hobbyhub-OrdersTable-ORIGINAL',
    'hobbyhub-ProductsTable-KC31XDEOENBG',
    'hobbyhub-InventoryTable-X2IRQDAGW7WB',
    'hobbyhub-checkout-v2-sandbox-foundation-StockV2-TEST12345',
    'hobbyhub-checkout-v2-sandbox-foundation-OrdersV2-*'
  ])assert.throws(()=>plan({orderTable:name}),/isolated/);
});
