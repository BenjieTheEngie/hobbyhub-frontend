/**
 * INERT TEST-MODE ORDER BINDING. No Stripe API call, DynamoDB write, Lambda,
 * IAM privileges, real payment collection or migration.
 *
 * Trusted backend must create and separately retrieve the official Stripe
 * TEST Checkout Session using its server-owned SDK. A browser-provided Session
 * must never be accepted as proof. This models only the first immutable
 * RESERVED -> session-bound PENDING step, NOT payment settlement.
 */
const ORDER_TABLE=/^hobbyhub-checkout-v2-sandbox-foundation-OrdersV2-[A-Z0-9]{8,32}$/;
const SESSION=/^cs_test_[A-Za-z0-9_]{8,200}$/;
const ORDER_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HMAC=/^hmac-v1-[a-f0-9]{64}$/;
const RATE=/^rate_[A-Za-z0-9]{8,80}$/;
function utc(value,label){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)||
    !Number.isFinite(Date.parse(value)))
    throw Error('Trusted UTC '+label+' required.');
  return Date.parse(value);
}
function eligibleReservedOrder(order,now){
  if(!order||!ORDER_ID.test(order.orderId||'')||
    !Number.isSafeInteger(order.version)||order.version<1||
    order.status!=='RESERVED'||order.paymentStatus!=='PENDING'||
    order.fulfillmentStatus!=='UNFULFILLED'||
    order.shippingMethod!=='domestic_shipping'||
    order.shippingCountry!=='US'||order.pickupAvailable!==false||
    order.shippingAddressVerified!==true||
    !HMAC.test(order.shippingDestinationDigest||'')||
    order.rateMode!=='live'||order.rateProvider!=='easypost'||
    !/^[A-Z]{2}$/.test(order.shippingState||'')||
    order.stripeSessionId!==undefined||order.paymentSessionId!==undefined||
    order.paymentMode!==undefined||
    order.taxCents!==null||order.totalCents!==null||
    order.currency!=='usd'||
    !Number.isSafeInteger(order.subtotalCents)||order.subtotalCents<1||
    !Number.isSafeInteger(order.shippingCents)||order.shippingCents<1||
    !Array.isArray(order.items)||order.items.length<1||order.items.length>20)
    throw Error('Unbound, verified U.S. pending Order V2 reservation required.');
  const expires=utc(order.reservedUntil,'reservation hold'),
    quotedUntil=utc(order.carrierQuoteExpiresAt,'carrier quote expiry');
  if(expires<=now||quotedUntil<=expires)
    throw Error('Carrier quote must outlast unexpired reservation.');
  let count=0,subtotal=0;
  const ids=new Set();
  for(const x of order.items){
    if(!ORDER_ID.test(x?.productId||'')||ids.has(x.productId)||
      !Number.isSafeInteger(x.qty)||x.qty<1||x.qty>20||
      !Number.isSafeInteger(x.unitPriceCents)||x.unitPriceCents<1||
      !Number.isSafeInteger(x.lineTotalCents)||
      x.lineTotalCents!==x.qty*x.unitPriceCents)
      throw Error('Server-owned immutable order items are invalid.');
    ids.add(x.productId);
    count+=x.qty;subtotal+=x.lineTotalCents;
  }
  if(subtotal!==order.subtotalCents||count<1||count>8||
    !Array.isArray(order.carrierRateIds)||order.carrierRateIds.length!==count||
    !Array.isArray(order.carrierRateDetails)||order.carrierRateDetails.length!==count)
    throw Error('Incomplete independently rated merchant-packed parcel snapshots.');
  let shipping=0;
  const seen=new Set();
  for(let i=0;i<count;i++){
    const id=order.carrierRateIds[i],r=order.carrierRateDetails[i];
    if(typeof id!=='string'||!RATE.test(id)||seen.has(id)||
      !r||r.rateId!==id||!Number.isSafeInteger(r.shippingCents)||
      r.shippingCents<1||r.shippingCents>50000)
      throw Error('Unverified or duplicated physical parcel shipping rate.');
    seen.add(id);shipping+=r.shippingCents;
  }
  if(shipping!==order.shippingCents||shipping>50000)
    throw Error('Order shipping does not equal all approved physical carrier rates.');
}
/**
 * Plans one DynamoDB UpdateItem, NOT a TransactWriteItems or payment handler.
 * Locks session IDs once, conditioned on original order version/reservation.
 * Stripe Tax and total remain NULL. Payment remains PENDING.
 */
export function planBindStripeTestCheckoutSession({
  order,retrievedSession,orderTable,now
}={}){
  const stamp=utc(now,'Stripe session binding time');
  if(typeof orderTable!=='string'||!ORDER_TABLE.test(orderTable))
    throw Error('Only isolated Order V2 sandbox table may be updated.');
  eligibleReservedOrder(order,stamp);
  if(!retrievedSession||retrievedSession.object!=='checkout.session'||
    retrievedSession.livemode!==false||retrievedSession.mode!=='payment'||
    !SESSION.test(retrievedSession.id||'')||
    retrievedSession.client_reference_id!==order.orderId||
    retrievedSession.metadata?.orderId!==order.orderId||
    retrievedSession.currency!=='usd'||
    retrievedSession.status!=='open'||retrievedSession.payment_status!=='unpaid'||
    retrievedSession.automatic_tax?.enabled!==true||
    retrievedSession.amount_subtotal!==order.subtotalCents||
    retrievedSession.shipping_cost?.amount_total!==order.shippingCents)
    throw Error('A server-retrieved open/unpaid Stripe TEST Session matching immutable totals is required.');
  const params={
    TableName:orderTable,Key:{orderId:order.orderId},
    UpdateExpression:[
      'SET #stripe = :session, #paymentSession = :session',
      '#paymentMode = :test, #version = #version + :one',
      '#updated = :now'
    ].join(', '),
    ConditionExpression:[
      'attribute_exists(orderId)',
      '#version = :version',
      '#status = :reserved',
      '#payment = :pending',
      '#fulfillment = :unfulfilled',
      'attribute_not_exists(#stripe)',
      'attribute_not_exists(#paymentSession)',
      'attribute_not_exists(#paymentMode)',
      '#digest = :digest',
      '#shippingCents = :shipping',
      '#subtotalCents = :subtotal',
      '#reservedUntil = :reservedUntil',
      '#carrierQuoteExpiresAt = :carrierQuoteExpiresAt'
    ].join(' AND '),
    ExpressionAttributeNames:{
      '#stripe':'stripeSessionId','#paymentSession':'paymentSessionId',
      '#paymentMode':'paymentMode','#version':'version','#updated':'updatedAt',
      '#status':'status','#payment':'paymentStatus',
      '#fulfillment':'fulfillmentStatus','#digest':'shippingDestinationDigest',
      '#shippingCents':'shippingCents','#subtotalCents':'subtotalCents',
      '#reservedUntil':'reservedUntil',
      '#carrierQuoteExpiresAt':'carrierQuoteExpiresAt'
    },
    ExpressionAttributeValues:{
      ':session':retrievedSession.id,':test':'test',':one':1,':now':new Date(stamp).toISOString(),
      ':version':order.version,':reserved':'RESERVED',':pending':'PENDING',
      ':unfulfilled':'UNFULFILLED',':digest':order.shippingDestinationDigest,
      ':shipping':order.shippingCents,':subtotal':order.subtotalCents,
      ':reservedUntil':order.reservedUntil,
      ':carrierQuoteExpiresAt':order.carrierQuoteExpiresAt
    }
  };
  return Object.freeze({
    kind:'offline-stripe-test-session-binding-plan',
    executable:false,checkoutEnabled:false,
    paymentWriteAuthorized:false,stockWriteAuthorized:false,
    fulfillmentAuthorized:false,
    orderId:order.orderId,sessionId:retrievedSession.id,
    nextOrderVersion:order.version+1,
    taxFinalized:false,amountFinalized:false,requiresSignedWebhook:true,
    update:params
  });
}
