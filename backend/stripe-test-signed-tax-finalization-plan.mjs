import {retrieveSignedStripeTestSession} from './stripe-test-session-fetch.mjs';
import {reviewStripeTestCheckoutReconciliation} from './stripe-v2-reconciliation.mjs';

/**
 * Source-only Stripe TEST tax/total finalization plan. No AWS or Stripe writes.
 * A trusted backend supplies its own Stripe SDK and raw webhook request.
 * Signature verification AND server-side session retrieval are mandatory
 * before an authoritative amount may appear in a conditional Order V2 update.
 */
const ORDER_TABLE=/^hobbyhub-checkout-v2-sandbox-foundation-OrdersV2-[A-Z0-9]{8,32}$/;
const TEST_SESSION=/^cs_test_[A-Za-z0-9_]{8,200}$/;
const HMAC=/^hmac-v1-[a-f0-9]{64}$/;
function serverUTC(now){
  if(typeof now!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(now)||
    !Number.isFinite(Date.parse(now)))
    throw Error('Trusted UTC tax finalization clock required.');
  return new Date(now).toISOString();
}
function preflight(order,table,stamp){
  if(typeof table!=='string'||!ORDER_TABLE.test(table))
    throw Error('Only isolated Orders V2 sandbox table may finalize Stripe TEST totals.');
  if(!order||!Number.isSafeInteger(order.version)||order.version<2||
    order.status!=='RESERVED'||order.paymentStatus!=='PENDING'||
    order.fulfillmentStatus!=='UNFULFILLED'||
    order.paymentMode!=='test'||
    !TEST_SESSION.test(order.stripeSessionId||'')||
    order.paymentSessionId!==order.stripeSessionId||
    order.currency!=='usd'||order.shippingCountry!=='US'||
    order.shippingMethod!=='domestic_shipping'||order.pickupAvailable!==false||
    order.shippingAddressVerified!==true||
    !HMAC.test(order.shippingDestinationDigest||'')||
    order.taxCents!==null||order.totalCents!==null||
    order.paymentEventId!==undefined||
    !Number.isSafeInteger(order.subtotalCents)||order.subtotalCents<1||
    !Number.isSafeInteger(order.shippingCents)||order.shippingCents<0)
    throw Error('Only signed-session-bound, untaxed pending TEST order may be finalized.');
  const until=Date.parse(order.reservedUntil),quote=Date.parse(order.carrierQuoteExpiresAt);
  if(!Number.isFinite(until)||!Number.isFinite(quote)||
    Date.parse(stamp)>until||Date.parse(stamp)>quote)
    throw Error('Expired reservation or carrier quote needs manual late-payment review.');
}
/**
 * When a signed paid Checkout event arrives, independently re-fetch the
 * Stripe Session, audit the final Stripe Tax/ship-to/parcel amounts using
 * the existing signed reconciliation, then plan ONE conditional Order Update.
 *
 * This is NOT settlement: after a real future write, the order is still
 * RESERVED/PENDING. A separate signed event inbox and ONE atomic Stock,
 * Order and existing event-receipt transaction are still mandatory.
 */
export async function planFinalizeSignedStripeTestOrderTotals({
  request,stripeSdk,webhookSigningSecret,order,
  checkedAt,destinationSigningKey,orderTable
}={}){
  const stamp=serverUTC(checkedAt);
  preflight(order,orderTable,stamp);
  const {event,session}=await retrieveSignedStripeTestSession({
    request,stripeSdk,webhookSigningSecret
  });
  if(event.sessionId!==order.stripeSessionId||
    event.orderId!==order.orderId||
    !['checkout.session.completed','checkout.session.async_payment_succeeded']
      .includes(event.type) ||
    session.status!=='complete'||session.payment_status!=='paid'||
    session.automatic_tax?.enabled!==true||
    session.automatic_tax?.status!=='complete')
    throw Error('Signed TEST completed/paid Checkout with finished automatic tax required.');
  const tax=session.total_details?.amount_tax,total=session.amount_total;
  if(!Number.isSafeInteger(tax)||tax<0||tax>5_100_000||
    !Number.isSafeInteger(total)||total<=0||total>5_100_000||
    total!==order.subtotalCents+order.shippingCents+tax)
    throw Error('Stripe TEST tax or paid total is not verified against the original order.');
  // Temporary clone for the pure audit ONLY: it cannot persist tax/total.
  const proposed=Object.freeze({...order,taxCents:tax,totalCents:total});
  const review=reviewStripeTestCheckoutReconciliation({
    request,stripeSdk,webhookSigningSecret,retrievedSession:session,
    order:proposed,checkedAt:stamp,destinationSigningKey,
    previousEvents:new Map()
  });
  if(review.pendingAtomicSettlement!==true||
     review.requiresHumanReview!==false||review.duplicateEvent!==false||
     review.disposition!=='RECONCILE_PAID_AND_STOCK_ATOMICALLY'||
     review.totalAuditDisposition!=='MATCHED_TEST_PAYMENT_REQUIRES_ATOMIC_RECONCILIATION')
    throw Error('Signed paid TEST event is not eligible for automatic tax finalization.');
  const update={
    TableName:orderTable,Key:{orderId:order.orderId},
    UpdateExpression:'SET #tax = :tax, #total = :total, #version = #version + :one, #updated = :now',
    ConditionExpression:[
      'attribute_exists(orderId)',
      '#version = :version','#status = :reserved','#payment = :pending',
      '#fulfillment = :unfulfilled',
      '#stripeSession = :session','#paymentSession = :session',
      '#paymentMode = :test',
      'attribute_type(#tax, :nullType)','attribute_type(#total, :nullType)',
      'attribute_not_exists(#paymentEvent)',
      '#subtotal = :subtotal','#shipping = :shipping',
      '#digest = :digest','#shippingState = :state',
      '#reservedUntil = :reservedUntil',
      '#quoteExpiry = :quoteExpiry'
    ].join(' AND '),
    ExpressionAttributeNames:{
      '#tax':'taxCents','#total':'totalCents','#version':'version',
      '#updated':'updatedAt','#status':'status','#payment':'paymentStatus',
      '#fulfillment':'fulfillmentStatus','#stripeSession':'stripeSessionId',
      '#paymentSession':'paymentSessionId','#paymentMode':'paymentMode',
      '#paymentEvent':'paymentEventId','#subtotal':'subtotalCents',
      '#shipping':'shippingCents','#digest':'shippingDestinationDigest',
      '#shippingState':'shippingState','#reservedUntil':'reservedUntil',
      '#quoteExpiry':'carrierQuoteExpiresAt'
    },
    ExpressionAttributeValues:{
      ':tax':tax,':total':total,':one':1,':now':stamp,
      ':version':order.version,':reserved':'RESERVED',':pending':'PENDING',
      ':unfulfilled':'UNFULFILLED',':session':order.stripeSessionId,
      ':test':'test',':nullType':'NULL',
      ':subtotal':order.subtotalCents,':shipping':order.shippingCents,
      ':digest':order.shippingDestinationDigest,':state':order.shippingState,
      ':reservedUntil':order.reservedUntil,
      ':quoteExpiry':order.carrierQuoteExpiresAt
    }
  };
  return Object.freeze({
    kind:'offline-signed-stripe-test-tax-finalization-plan',
    executable:false,checkoutEnabled:false,
    paymentWriteAuthorized:false,stockWriteAuthorized:false,
    fulfillmentAuthorized:false,
    orderId:order.orderId,eventId:event.eventId,sessionId:session.id,
    nextOrderVersion:order.version+1,
    taxCents:tax,totalCents:total,
    signedProviderMustBeReverified:true,
    settled:false,orderStatus:'RESERVED',paymentStatus:'PENDING',
    update
  });
}

/**
 * OFFLINE crash-recovery review for a finalized-but-still-RESERVED order.
 * A future signed-webhook Lambda MUST strongly consistently read the order,
 * then use this gate when tax/total are already non-NULL instead of trying
 * to repeat the conditional tax finalization update.
 *
 * This performs no AWS writes, no settlement and no fulfillment action.
 */
export async function reviewAlreadyFinalizedStripeTestOrder({
  request,stripeSdk,webhookSigningSecret,order,
  checkedAt,destinationSigningKey,orderTable
}={}){
  const stamp=serverUTC(checkedAt);
  if(typeof orderTable!=='string'||!ORDER_TABLE.test(orderTable))
    throw Error('Only isolated Orders V2 sandbox table may recover finalized Stripe TEST totals.');
  if(!order||!Number.isSafeInteger(order.version)||order.version<3||
    order.status!=='RESERVED'||order.paymentStatus!=='PENDING'||
    order.fulfillmentStatus!=='UNFULFILLED'||
    order.paymentEventId!==undefined||
    order.paymentMode!=='test'||
    !TEST_SESSION.test(order.stripeSessionId||'')||
    order.paymentSessionId!==order.stripeSessionId||
    !Number.isSafeInteger(order.taxCents)||order.taxCents<0||
    !Number.isSafeInteger(order.totalCents)||order.totalCents<=0||
    order.totalCents!==order.subtotalCents+order.shippingCents+order.taxCents)
    throw Error('Strongly consistent finalized but unpaid TEST Order V2 snapshot is required.');
  const {session}=await retrieveSignedStripeTestSession({
    request,stripeSdk,webhookSigningSecret
  });
  const review=reviewStripeTestCheckoutReconciliation({
    request,stripeSdk,webhookSigningSecret,retrievedSession:session,
    order,checkedAt:stamp,destinationSigningKey,previousEvents:new Map()
  });
  if(review.pendingAtomicSettlement!==true||
     review.requiresHumanReview!==false||review.duplicateEvent!==false||
     review.disposition!=='RECONCILE_PAID_AND_STOCK_ATOMICALLY'||
     review.totalAuditDisposition!=='MATCHED_TEST_PAYMENT_REQUIRES_ATOMIC_RECONCILIATION')
    throw Error('Finalized Stripe TEST order requires human review or mismatches the provider.');
  return Object.freeze({
    kind:'offline-already-finalized-stripe-test-order-review',
    alreadyFinalized:true,requiresDurableEventInbox:true,
    requiresAtomicStockSettlement:true,settled:false,
    executable:false,checkoutEnabled:false,
    paymentWriteAuthorized:false,stockWriteAuthorized:false,
    fulfillmentAuthorized:false,
    orderId:order.orderId,eventId:review.eventId,sessionId:review.sessionId,
    expectedOrderVersion:order.version,
    fingerprint:review.fingerprint,
    taxCents:order.taxCents,totalCents:order.totalCents,
    // No Update/Put/TransactItems; all Stripe and AWS write decisions deferred.
  });
}
