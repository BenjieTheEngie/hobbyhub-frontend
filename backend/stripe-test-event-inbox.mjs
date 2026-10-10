import {retrieveSignedStripeTestSession} from './stripe-test-session-fetch.mjs';
import {reviewStripeTestCheckoutReconciliation} from './stripe-v2-reconciliation.mjs';
import {verifiedWebhookEventFingerprint} from './payment-webhook-review.mjs';

/**
 * NOT a Lambda handler. Offline-testable, source-only adapter for the already
 * deployed EMPTY Stripe TEST event ledger. A future trusted Lambda must supply
 * SDK-verified server data, official Stripe SDK and server secret(s), and an
 * AWS DocumentClient wrapper restricted to this ONE table.
 *
 * Persistence here means REVIEW RECEIVED, never paid/settled/fulfilled. There
 * are deliberately no stock, order or Stripe API mutations in this module.
 */
const TABLE=/^hobbyhub-stripe-sandbox-ledgers-StripeTestEventLedger-[A-Z0-9]{8,32}$/;
const HEX=/^[a-f0-9]{64}$/;
const RECORD_STATE='PENDING_REVIEW';
const DURABLE_SETTLED_STATE='SETTLED';
const DISPOSITIONS=new Set([
  'ALREADY_REVIEWED',
  'RECONCILE_PAID_AND_STOCK_ATOMICALLY',
  'WAIT_FOR_VERIFIED_PAYMENT',
  'REVIEW_RELEASE_WITH_LATE_PAYMENT_SAFEGUARDS',
  'REVIEW_LATE_PAYMENT_AND_REFUND_POLICY'
]);
const TOTAL_DISPOSITIONS=new Set([
  'MATCHED_TEST_PAYMENT_REQUIRES_ATOMIC_RECONCILIATION',
  'LATE_PAYMENT_REQUIRES_REVIEW',
  'AWAIT_PROVIDER_PAYMENT',
  'REVIEW_EXPIRED_SESSION_BEFORE_STOCK_RELEASE',
  'REVIEW_PROVIDER_STATE_MISMATCH'
]);
const OWN=(v,key)=>Object.prototype.hasOwnProperty.call(v,key);
function tableName(name){
  if(typeof name!=='string'||!TABLE.test(name))
    throw Error('Only the isolated Stripe TEST event ledger table is allowed.');
  return name;
}
function checkedAtISO(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)||
      !Number.isFinite(Date.parse(value)))
    throw Error('Trusted UTC server webhook timestamp is required.');
  return new Date(value).toISOString();
}
function validateRecordedEvent(row,event){
  if(!row||typeof row!=='object'||Array.isArray(row)||
     row.schemaVersion!==1||
     ![RECORD_STATE,DURABLE_SETTLED_STATE].includes(row.state)||
     row.eventId!==event.eventId||row.provider!=='stripe'||row.mode!=='test'||
     !HEX.test(row.fingerprint||'')||
     row.orderId!==event.orderId||row.sessionId!==event.sessionId)
    throw Error('Existing Stripe event ledger row is inconsistent: manual review required.');
  if(row.fingerprint!==event.fingerprint)
    throw Error('Stripe event ID collision with a different verified payload.');
  if(row.state===DURABLE_SETTLED_STATE &&
    (!Number.isSafeInteger(row.settledOrderVersion)||
      row.settledOrderVersion<2||
      typeof row.settledAt!=='string'||
      !Number.isFinite(Date.parse(row.settledAt))||
      !Number.isFinite(Date.parse(row.recordedAt))||
      Date.parse(row.settledAt)<Date.parse(row.recordedAt)))
    throw Error('Settled Stripe receipt requires durable matching transaction metadata.');
}
function makeRecord(review,checkedAt){
  if(!review||review.kind!=='stripe-test-v2-inert-reconciliation'||
     typeof review.eventId!=='string'||typeof review.orderId!=='string'||
     typeof review.sessionId!=='string'||!HEX.test(review.fingerprint||'')||
     !DISPOSITIONS.has(review.disposition)||
     !TOTAL_DISPOSITIONS.has(review.totalAuditDisposition)||
     review.executable!==false||review.paymentCollectionEnabled!==false||
     review.paymentWriteAuthorized!==false||review.stockWriteAuthorized!==false||
     review.fulfillmentAuthorized!==false)
    throw Error('Only an inert signed Stripe sandbox reconciliation is recordable.');
  return Object.freeze({
    eventId:review.eventId,
    schemaVersion:1,provider:'stripe',mode:'test',
    state:RECORD_STATE,
    fingerprint:review.fingerprint,
    orderId:review.orderId,
    sessionId:review.sessionId,
    reviewDisposition:review.disposition,
    totalAuditDisposition:review.totalAuditDisposition,
    recordedAt:checkedAtISO(checkedAt),
    // No payment capture, stock capture, shipping label, customer PII or TTL.
  });
}
function isConditionalConflict(error){
  return error?.name==='ConditionalCheckFailedException' ||
    error?.code==='ConditionalCheckFailedException';
}
/**
 * Persist only a verification receipt into the actual isolated TEST table.
 *
 * ledgerClient supports async get({TableName,Key,ConsistentRead}) and
 * put({TableName,Item,ConditionExpression}), such as a future thin wrapper
 * around @aws-sdk/lib-dynamodb GetCommand/PutCommand. This module does not
 * construct AWS clients, import AWS credentials or call real AWS by itself.
 *
 * Strongly consistent reads are for collision/retry explanation; the
 * CONDITIONAL PUT is the atomic deduplication authority under concurrency.
 *
 * IMPORTANT: A row marked PENDING_REVIEW must NOT be mistaken for a completed
 * settlement. A crash after Put is NOT a captured order. A replay requires
 * separate durable order+stock reconciliation before any fulfillment.
 */
export async function recordVerifiedStripeTestEventForReview({
  request,stripeSdk,webhookSigningSecret,order,
  checkedAt,destinationSigningKey,ledgerClient,eventTable
}={}){
  const name=tableName(eventTable);
  if(!ledgerClient||typeof ledgerClient.get!=='function'||
      typeof ledgerClient.put!=='function')
    throw Error('A trusted consistent-read, conditional-write TEST ledger client is required.');
  const stamp=checkedAtISO(checkedAt);

  // Authenticate FIRST and retrieve Stripe's Session through a trusted
  // server-owned SDK before the first database read or write.
  const {event:authenticated,session:retrievedSession}=
    await retrieveSignedStripeTestSession({
      request,stripeSdk,webhookSigningSecret
    });
  const key=Object.freeze({eventId:authenticated.eventId});
  const lookup=async()=>ledgerClient.get({
    TableName:name,Key:key,ConsistentRead:true
  });
  const existing=await lookup();
  if(existing===null||typeof existing!=='object'||Array.isArray(existing))
    throw Error('Trusted DynamoDB Get result is required.');

  // A paid/settled order is no longer RESERVED. Duplicate deliveries of
  // the already-SETTLED signed event must return a NO-WRITE receipt without
  // re-running pre-payment audits that correctly require RESERVED status.
  // Verify signature, server-retrieved provider session, immutable event
  // fingerprint and order identity FIRST; never authorize a stock action.
  if(existing.Item?.state===DURABLE_SETTLED_STATE){
    const verified={
      eventId:authenticated.eventId,orderId:authenticated.orderId,
      sessionId:authenticated.sessionId,
      fingerprint:verifiedWebhookEventFingerprint(authenticated)
    };
    validateRecordedEvent(existing.Item,verified);
    if(!order||order.orderId!==authenticated.orderId||
       order.stripeSessionId!==authenticated.sessionId||
       order.paymentMode!=='test'||
       retrievedSession.payment_status!==authenticated.paymentStatus||
       retrievedSession.amount_total!==authenticated.amountTotalCents||
       retrievedSession.currency!==authenticated.currency)
      throw Error('Already-settled Stripe TEST receipt differs from stored order or provider session.');
    return Object.freeze({
      kind:'stripe-test-ledger-receipt',
      state:DURABLE_SETTLED_STATE,alreadyRecorded:true,
      eventId:authenticated.eventId,orderId:authenticated.orderId,
      requiresDurableSettlement:false,
      paymentWriteAuthorized:false,stockWriteAuthorized:false,
      fulfillmentAuthorized:false,checkoutEnabled:false
    });
  }

  const previousEvents=new Map();
  if(OWN(existing,'Item')&&existing.Item!==undefined){
    if(!existing.Item||typeof existing.Item!=='object')
      throw Error('Existing Stripe event ledger value is invalid.');
    previousEvents.set(authenticated.eventId,{
      fingerprint:existing.Item.fingerprint
    });
  }
  const review=reviewStripeTestCheckoutReconciliation({
    request,stripeSdk,webhookSigningSecret,retrievedSession,
    order,checkedAt:stamp,destinationSigningKey,previousEvents
  });
  const record=makeRecord(review,stamp);
  if(record.eventId!==authenticated.eventId ||
     record.orderId!==authenticated.orderId ||
     record.sessionId!==authenticated.sessionId)
    throw Error('Signed Stripe event changed during review.');

  if(existing.Item!==undefined){
    validateRecordedEvent(existing.Item,record);
    return Object.freeze({
      kind:'stripe-test-ledger-receipt',
      state:existing.Item.state,alreadyRecorded:true,eventId:record.eventId,
      orderId:record.orderId,
      requiresDurableSettlement:existing.Item.state!==DURABLE_SETTLED_STATE,
      paymentWriteAuthorized:false,stockWriteAuthorized:false,
      fulfillmentAuthorized:false,checkoutEnabled:false
    });
  }

  if(review.disposition==='ALREADY_REVIEWED')
    throw Error('A replay-only event must not create a new pending review record.');

  try{
    await ledgerClient.put({
      TableName:name,Item:record,
      ConditionExpression:'attribute_not_exists(eventId)'
    });
  }catch(error){
    if(!isConditionalConflict(error))throw error;
    // A concurrent webhook replica won the PutItem. Never overwrite it.
    const raced=await lookup();
    if(!raced||!OWN(raced,'Item')||raced.Item===undefined)
      throw Error('Stripe event conditional conflict without readable durable record.');
    validateRecordedEvent(raced.Item,record);
    return Object.freeze({
      kind:'stripe-test-ledger-receipt',
      state:raced.Item.state,alreadyRecorded:true,eventId:record.eventId,
      orderId:record.orderId,
      requiresDurableSettlement:raced.Item.state!==DURABLE_SETTLED_STATE,
      paymentWriteAuthorized:false,stockWriteAuthorized:false,
      fulfillmentAuthorized:false,checkoutEnabled:false
    });
  }
  return Object.freeze({
    kind:'stripe-test-ledger-receipt',
    state:RECORD_STATE,alreadyRecorded:false,eventId:record.eventId,
    orderId:record.orderId,
    requiresDurableSettlement:true,
    paymentWriteAuthorized:false,stockWriteAuthorized:false,
    fulfillmentAuthorized:false,checkoutEnabled:false
  });
}
