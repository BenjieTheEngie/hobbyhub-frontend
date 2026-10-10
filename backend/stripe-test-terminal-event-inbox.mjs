import {retrieveSignedStripeTestSession} from './stripe-test-session-fetch.mjs';
import {verifiedWebhookEventFingerprint} from './payment-webhook-review.mjs';

/**
 * OFFLINE/TEST-ONLY terminal Checkout webhook inbox. No Lambda or live route,
 * AWS client, Stripe keys, automated refunds, stock releases or payments.
 *
 * Unpaid completion, expiry and async-failure events can precede finalized Stripe Tax. Unlike a paid
 * event, they MUST NOT be forced through finalized tax/total reconciliation.
 * They still require SDK raw-body signature verification, an independently
 * server-retrieved TEST Session, and a strongly consistent, conditional
 * write to the isolated eventId-keyed Stripe TEST ledger.
 */
const TABLE=/^hobbyhub-stripe-sandbox-ledgers-StripeTestEventLedger-[A-Z0-9]{8,32}$/;
const SESSION=/^cs_test_[A-Za-z0-9_]{8,200}$/;
const HEX=/^[a-f0-9]{64}$/;
const EVENT_TYPES=new Set(['checkout.session.completed','checkout.session.expired','checkout.session.async_payment_failed']);
const TERMINAL_REVIEW='REVIEW_RELEASE_WITH_LATE_PAYMENT_SAFEGUARDS';
const AWAIT_PAYMENT='WAIT_FOR_VERIFIED_PAYMENT';
const AUDITS=Object.freeze({
  'checkout.session.completed':'AWAIT_PROVIDER_PAYMENT',
  'checkout.session.expired':'REVIEW_EXPIRED_SESSION_BEFORE_STOCK_RELEASE',
  'checkout.session.async_payment_failed':'REVIEW_PROVIDER_STATE_MISMATCH'
});
function utc(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)||
    !Number.isFinite(Date.parse(value)))
    throw Error('Trusted UTC terminal-event receipt timestamp required.');
  return new Date(value).toISOString();
}
function validateInputs({event,session,order,now}){
  if(!EVENT_TYPES.has(event.type)||event.paymentStatus!=='unpaid'||
     session.payment_status!=='unpaid'||
     !Number.isSafeInteger(session.amount_total)||session.amount_total<0||
     session.amount_total!==event.amountTotalCents||
     (event.type==='checkout.session.completed'&&session.status!=='complete')||
     (event.type==='checkout.session.expired'&&session.status!=='expired')||
     (event.type==='checkout.session.async_payment_failed'&&
        !['complete','expired'].includes(session.status)))
    throw Error('Terminal Stripe TEST event and server-retrieved unpaid Session do not agree.');
  if(!order||order.orderId!==event.orderId||
    order.stripeSessionId!==event.sessionId||
    order.paymentSessionId!==event.sessionId||
    !SESSION.test(order.paymentSessionId||'')||
    order.paymentMode!=='test'||
    order.status!=='RESERVED'||order.paymentStatus!=='PENDING'||
    order.fulfillmentStatus!=='UNFULFILLED'||
    order.shippingCountry!=='US'||
    order.shippingMethod!=='domestic_shipping'||
    order.pickupAvailable!==false||
    !Number.isSafeInteger(order.version)||order.version<2||
    typeof order.reservedUntil!=='string'||
    !Number.isFinite(Date.parse(order.reservedUntil))||!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(order.reservedUntil))
    throw Error('Only a matching still-reserved unpaid TEST order can record terminal review.');
  // A failed Session can have unsettled/null tax and totals. Never infer
  // missing tax is zero or that a failed payment cannot later succeed.
  if(order.totalCents!==null&&order.totalCents!==undefined&&
     (!Number.isSafeInteger(order.totalCents)||
       order.totalCents!==session.amount_total))
    throw Error('Terminal Stripe TEST provider total conflicts with finalized order.');
  if(order.taxCents!==null&&order.taxCents!==undefined&&
     (!Number.isSafeInteger(order.taxCents)||order.taxCents<0))
    throw Error('Finalized Stripe TEST order tax is invalid.');
  return Date.parse(now)<Date.parse(order.reservedUntil);
}
function validateExisting(row,record){
  if(!row||typeof row!=='object'||Array.isArray(row)||
    row.schemaVersion!==1||row.provider!=='stripe'||row.mode!=='test'||
    row.state!=='PENDING_REVIEW'||row.eventId!==record.eventId||
    row.orderId!==record.orderId||row.sessionId!==record.sessionId||
    !HEX.test(row.fingerprint||'')||
    row.reviewDisposition!==record.reviewDisposition||
    row.totalAuditDisposition!==record.totalAuditDisposition||
    typeof row.recordedAt!=='string'||!Number.isFinite(Date.parse(row.recordedAt)))
    throw Error('Existing terminal Stripe TEST event receipt is inconsistent: manual investigation required.');
  if(row.fingerprint!==record.fingerprint)
    throw Error('Stripe terminal event ID collision with a different signed payload.');
}
function duplicate(record,holdStillActive){
  return Object.freeze({
    kind:'stripe-test-terminal-event-receipt',
    eventId:record.eventId,orderId:record.orderId,
    state:'PENDING_REVIEW',alreadyRecorded:true,
    holdStillActive,
    requiresManualReview:record.reviewDisposition!==AWAIT_PAYMENT,
    requiresDurablePaymentCheck:true,
    stockReleaseAuthorized:false,paymentWriteAuthorized:false,
    stockWriteAuthorized:false,fulfillmentAuthorized:false,
    checkoutEnabled:false
  });
}
/**
 * Authenticates and conditionally records only a PENDING_REVIEW receipt.
 * ledgerClient must be a trusted isolated DocumentClient get/put wrapper;
 * production IAM and a real endpoint are NOT provisioned by this module.
 */
export async function recordSignedStripeTestUnpaidEventForReview({
  request,stripeSdk,webhookSigningSecret,order,
  checkedAt,ledgerClient,eventTable
}={}){
  if(typeof eventTable!=='string'||!TABLE.test(eventTable))
    throw Error('Only the isolated Stripe TEST event ledger is permitted.');
  if(!ledgerClient||typeof ledgerClient.get!=='function'||
    typeof ledgerClient.put!=='function')
    throw Error('A trusted consistent-read and conditional-write TEST event ledger client is required.');
  const now=utc(checkedAt);
  // Signature is verified before any Stripe provider lookup or DynamoDB call.
  const {event,session}=await retrieveSignedStripeTestSession({
    request,stripeSdk,webhookSigningSecret
  });
  const holdStillActive=validateInputs({event,session,order,now});
  const record=Object.freeze({
    eventId:event.eventId,schemaVersion:1,provider:'stripe',mode:'test',
    state:'PENDING_REVIEW',
    fingerprint:verifiedWebhookEventFingerprint(event),
    orderId:event.orderId,sessionId:event.sessionId,
    reviewDisposition:event.type==='checkout.session.completed'?
      AWAIT_PAYMENT:TERMINAL_REVIEW,
    totalAuditDisposition:AUDITS[event.type],
    recordedAt:now
  });
  const lookup=async()=>ledgerClient.get({
    TableName:eventTable,Key:{eventId:event.eventId},ConsistentRead:true
  });
  const existing=await lookup();
  if(!existing||typeof existing!=='object'||Array.isArray(existing))
    throw Error('DynamoDB terminal-event read did not return a valid object.');
  if(existing.Item!==undefined){
    validateExisting(existing.Item,record);
    return duplicate(record,holdStillActive);
  }
  try{
    await ledgerClient.put({
      TableName:eventTable,Item:record,
      ConditionExpression:'attribute_not_exists(eventId)'
    });
  }catch(err){
    if(err?.name!=='ConditionalCheckFailedException'&&
       err?.code!=='ConditionalCheckFailedException')
      throw err;
    const raced=await lookup();
    if(!raced||raced.Item===undefined)
      throw Error('Terminal-event conditional conflict without durable receipt.');
    validateExisting(raced.Item,record);
    return duplicate(record,holdStillActive);
  }
  return Object.freeze({
    ...duplicate(record,holdStillActive),
    alreadyRecorded:false
  });
}

// Backwards-compatible name for existing expired/async-failed integrations.
// Both names are source-only; neither is an AWS Lambda or public endpoint.
export const recordSignedStripeTestTerminalEventForReview=
  recordSignedStripeTestUnpaidEventForReview;
