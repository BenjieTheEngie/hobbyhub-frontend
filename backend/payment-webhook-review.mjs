import {createHash} from 'node:crypto';

/**
 * STRIPE WEBHOOK RECONCILIATION - PURE / OFFLINE MODEL ONLY.
 * This is not a Lambda/webhook receiver. It does not verify Stripe signatures
 * itself, mark orders paid, release/capture stock, accept money or create a
 * DynamoDB write. A later handler MUST verify raw-body Stripe signatures with
 * the official SDK and consult durable event records before calling this.
 */
const EVENT_TYPES=new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired'
]);
const EVENT_ID=/^evt_[A-Za-z0-9]{8,100}$/;
const SESSION_ID=/^cs_test_[A-Za-z0-9_]{8,200}$/;
const ORDER_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function verifiedWebhookEventFingerprint(event) {
  if(!event || !EVENT_ID.test(event.eventId||'') || !EVENT_TYPES.has(event.type))
    throw Error('Unrecognized provider event ID or event type.');
  if(event.mode!=='test'||!SESSION_ID.test(event.sessionId||''))
    throw Error('Only test-mode Stripe sessions are supported by this review.');
  if(!ORDER_ID.test(event.orderId||''))
    throw Error('Event requires an immutable referenced orderId.');
  if(!['paid','unpaid','no_payment_required'].includes(event.paymentStatus))
    throw Error('Unrecognized provider payment status.');
  if(event.currency!=='usd'||!Number.isSafeInteger(event.amountTotalCents)||
      event.amountTotalCents<0||event.amountTotalCents>100000000)
    throw Error('Provider amount must be verified integer USD cents.');
  return createHash('sha256').update(JSON.stringify({
    eventId:event.eventId,type:event.type,mode:event.mode,sessionId:event.sessionId,
    orderId:event.orderId,paymentStatus:event.paymentStatus,
    amountTotalCents:event.amountTotalCents,currency:event.currency
  })).digest('hex');
}
function verifyOrderSnapshot(order,event){
  if(!order||order.orderId!==event.orderId||!ORDER_ID.test(order.orderId||''))
    throw Error('Webhook order reference does not match the stored order.');
  if(order.stripeSessionId!==event.sessionId||order.paymentMode!=='test')
    throw Error('Webhook session does not match a server-stored test-mode session.');
  if(!Number.isSafeInteger(order.version)||order.version<1)
    throw Error('Order version is missing or invalid.');
  if(!Number.isSafeInteger(order.subtotalCents)||order.subtotalCents<=0||
     !Number.isSafeInteger(order.shippingCents)||order.shippingCents<0||
     !Number.isSafeInteger(order.taxCents)||order.taxCents<0||
     !Number.isSafeInteger(order.totalCents)||order.totalCents<=0||
     order.totalCents!==order.subtotalCents+order.shippingCents+order.taxCents||
     order.totalCents!==event.amountTotalCents||order.currency!=='usd')
    throw Error('Paid order total or tax/shipping does not match verified Stripe amount.');
  if(order.shippingCountry!=='US'||order.shippingMethod!=='domestic_shipping'||
     order.pickupAvailable!==false||!Array.isArray(order.items)||order.items.length===0)
    throw Error('Order is not eligible for U.S. delivery payment reconciliation.');
  if(order.status!=='RESERVED'||order.paymentStatus!=='PENDING'||
     order.fulfillmentStatus!=='UNFULFILLED')
    throw Error('Order is not in a clean prepayment reservation state.');
  if(!order.reservedUntil || !Number.isFinite(Date.parse(order.reservedUntil)))
    throw Error('Order has no verified reservation expiry.');
}
/**
 * A previousEvents Map is a trusted *persisted* replay ledger:
 * key=Stripe event ID, value={fingerprint}. A local JS Set is NOT sufficient
 * for production idempotency. We deliberately never update that Map here.
 */
export function reviewSignedTestPaymentEvent({event,order,trust,previousEvents,receivedAt}={}){
  if(trust?.signatureVerified!==true || trust?.verifiedBy!=='stripe-sdk-raw-body')
    throw Error('Event must be verified against a Stripe raw-body signature.');
  if(!(previousEvents instanceof Map))
    throw Error('Durable provider-event replay history is required.');
  const fingerprint=verifiedWebhookEventFingerprint(event);
  const prev=previousEvents.get(event.eventId);
  if(prev){
    if(prev.fingerprint!==fingerprint)throw Error('Stripe event ID collision with different payload.');
    return Object.freeze({
      disposition:'ALREADY_REVIEWED',eventId:event.eventId,orderId:event.orderId,
      fingerprint,stockReservationAction:'NONE',paymentWriteAuthorized:false,
      checkoutEnabled:false,fulfillmentAuthorized:false
    });
  }
  if(typeof receivedAt!=='string'||!Number.isFinite(Date.parse(receivedAt)))
    throw Error('Server receipt timestamp must be supplied.');
  verifyOrderSnapshot(order,event);
  let disposition;
  if((event.type==='checkout.session.completed'&&event.paymentStatus==='paid')||
     (event.type==='checkout.session.async_payment_succeeded'&&event.paymentStatus==='paid'))
    disposition='RECONCILE_PAID_AND_STOCK_ATOMICALLY';
  else if(event.type==='checkout.session.expired'||
          event.type==='checkout.session.async_payment_failed')
    disposition='REVIEW_RELEASE_WITH_LATE_PAYMENT_SAFEGUARDS';
  else disposition='WAIT_FOR_VERIFIED_PAYMENT';
  // An event may arrive after the reservation's expiry. Never auto-refund,
  // auto-release or auto-capture stock without durable state reconciliation.
  if(Date.parse(receivedAt)>Date.parse(order.reservedUntil)&&
     disposition==='RECONCILE_PAID_AND_STOCK_ATOMICALLY')
    disposition='REVIEW_LATE_PAYMENT_AND_REFUND_POLICY';
  return Object.freeze({
    disposition,eventId:event.eventId,orderId:event.orderId,fingerprint,
    expectedOrderVersion:order.version,
    stockReservationAction:'NONE',
    paymentWriteAuthorized:false,checkoutEnabled:false,
    fulfillmentAuthorized:false,
    requiresSignedWebhookLedger:true,
    requiresTransactionalStockReconciliation:true
  });
}
