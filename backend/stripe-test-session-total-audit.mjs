/**
 * Source-only reconciliation of a TEST Stripe Checkout Session to a trusted
 * V2 order and server-approved parcel/tax totals. No API calls or mutations.
 * Caller must retrieve the Stripe Session with a server-owned SDK; browsers,
 * redirects, screenshots and webhook bodies are NOT authoritative.
 */
const SESSION_ID=/^cs_test_[A-Za-z0-9_]{8,200}$/;
const ORDER_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PI_ID=/^pi_[A-Za-z0-9]{8,100}$/;
const MAX_SUBTOTAL=5_000_000;
const MAX_SHIPPING=50_000;
const MAX_TOTAL=5_100_000;
const ALLOWED_STATES=new Set([
  'AL','AZ','AR','CA','CO','CT','DE','FL','GA','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX',
  'UT','VT','VA','WA','WV','WI','WY','DC','AK','HI'
]);
function cents(n,min,max,label){
  if(!Number.isSafeInteger(n)||n<min||n>max)
    throw Error('Invalid confirmed '+label+' in integer USD cents.');
  return n;
}
function iso(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value)||!Number.isFinite(Date.parse(value)))
    throw Error('Valid server reservation timestamp is required.');
  return Date.parse(value);
}
function validLineItems(order){
  if(!Array.isArray(order.items)||order.items.length<1||order.items.length>20)
    throw Error('Immutable server order line items are missing.');
  const ids=new Set();let calculated=0;
  for(const x of order.items){
    if(!x||typeof x.productId!=='string'||!x.productId||ids.has(x.productId)||
       !Number.isSafeInteger(x.qty)||x.qty<1||x.qty>20)
      throw Error('Order item identity/quantity is invalid.');
    ids.add(x.productId);
    cents(x.unitPriceCents,1,5_000_000,'unit price');
    if(x.lineTotalCents!==x.qty*x.unitPriceCents)
      throw Error('Order item subtotal has changed.');
    calculated+=x.lineTotalCents;
  }
  if(calculated!==order.subtotalCents)
    throw Error('Server order subtotal does not match item snapshots.');
}
function usStateOf(session){
  const a=session.collected_information?.shipping_details?.address ||
          session.shipping_details?.address;
  const state=String(a?.state||'').toUpperCase();
  const country=String(a?.country||'').toUpperCase();
  const postal=String(a?.postal_code||'');
  if(country!=='US'||!ALLOWED_STATES.has(state)||!/^[0-9]{5}(?:-[0-9]{4})?$/.test(postal))
    throw Error('Stripe shipping destination is outside approved 50 states and DC.');
  return state;
}
/**
 * Compare an SDK-RETRIEVED session with the original read-only order.
 * No shipping address or customer PII is copied into the output.
 * The server must separately verify delivery, ship-from parcel, carrier
 * quote expiry/identity, Stripe provider payment status and event idempotency.
 */
export function auditStripeSandboxSessionTotals({session,order,checkedAt}={}){
  const checked=iso(checkedAt);
  if(!order||!ORDER_ID.test(order.orderId||'')||
     !SESSION_ID.test(order.stripeSessionId||'')||
     !Number.isSafeInteger(order.version)||order.version<1||
     order.paymentMode!=='test'||order.status!=='RESERVED'||
     order.paymentStatus!=='PENDING'||order.fulfillmentStatus!=='UNFULFILLED'||
     order.currency!=='usd'||order.shippingCountry!=='US'||
     order.shippingMethod!=='domestic_shipping'||order.pickupAvailable!==false||
     order.shippingAddressVerified!==true)
    throw Error('Verified unchanged test-mode U.S. order reservation is required.');
  const expires=iso(order.reservedUntil);
  if(!session||session.object!=='checkout.session'||session.livemode!==false||
     session.mode!=='payment'||!SESSION_ID.test(session.id||'')||
     session.id!==order.stripeSessionId||
     session.client_reference_id!==order.orderId||
     session.metadata?.orderId!==order.orderId||
     session.currency!=='usd')
    throw Error('Stripe test Checkout session and immutable order ID do not match.');
  const state=usStateOf(session);
  if(order.shippingState!==state)
    throw Error('Checkout destination changed since the server-approved carrier quote.');
  const subtotal=cents(order.subtotalCents,1,MAX_SUBTOTAL,'order subtotal');
  const shipping=cents(order.shippingCents,0,MAX_SHIPPING,'order shipping');
  const tax=cents(order.taxCents,0,MAX_TOTAL,'order tax');
  const total=cents(order.totalCents,1,MAX_TOTAL,'order total');
  if(subtotal+shipping+tax!==total)
    throw Error('Server-approved subtotal, shipping and tax do not add up to final total.');
  validLineItems(order);
  if(cents(session.amount_subtotal,1,MAX_SUBTOTAL,'provider item subtotal')!==subtotal ||
     cents(session.shipping_cost?.amount_total,0,MAX_SHIPPING,'provider shipping')!==shipping ||
     cents(session.total_details?.amount_tax,0,MAX_TOTAL,'provider tax')!==tax ||
     cents(session.total_details?.amount_discount,0,MAX_TOTAL,'provider discount')!==0 ||
     cents(session.amount_total,1,MAX_TOTAL,'provider total')!==total)
    throw Error('Stripe Checkout item, shipping, tax, discount or final charge changed.');
  if(session.automatic_tax?.enabled!==true||session.automatic_tax?.status!=='complete')
    throw Error('Stripe automatic tax calculation must be completed and verified.');
  if(!['open','complete','expired'].includes(session.status)||
     !['paid','unpaid'].includes(session.payment_status))
    throw Error('Unknown Stripe session or payment state.');
  let disposition='AWAIT_PROVIDER_PAYMENT';
  if(session.status==='complete'&&session.payment_status==='paid'){
    if(!PI_ID.test(session.payment_intent||''))
      throw Error('Paid Stripe Session must have a verified payment-intent ID.');
    disposition=checked>expires?'LATE_PAYMENT_REQUIRES_REVIEW':'MATCHED_TEST_PAYMENT_REQUIRES_ATOMIC_RECONCILIATION';
  }else if(session.status==='expired'){
    disposition='REVIEW_EXPIRED_SESSION_BEFORE_STOCK_RELEASE';
  }else if(session.payment_status==='paid'){
    disposition='REVIEW_PROVIDER_STATE_MISMATCH';
  }
  return Object.freeze({
    orderId:order.orderId,sessionId:session.id,expectedOrderVersion:order.version,
    amountCents:total,disposition,
    // Intentional non-authorization even when receipt/payment appears valid.
    paymentWriteAuthorized:false,stockWriteAuthorized:false,
    fulfillmentAuthorized:false,checkoutEnabled:false,
    requiresDurableSignedEventLedger:true,
    requiresAtomicStockSettlement:true
  });
}
