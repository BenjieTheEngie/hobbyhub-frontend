import {planVerifiedReservationSettlement} from './stock-reservation-settlement.mjs';

/**
 * PURE OFFLINE TRANSACTION PLAN. No AWS SDK, Stripe SDK, Lambda, payment
 * collection, database changes, permissions or fulfillment side effects.
 *
 * A future trusted service MUST independently verify the raw Stripe webhook
 * signature, re-fetch the exact TEST Checkout Session using server credentials,
 * validate tax, carrier quote and full address HMAC, and consistently read the
 * actual Order, Stock and existing PENDING_REVIEW event receipt. Never accept
 * review or eventRow directly from an HTTP body.
 */
const EVENT=/^evt_[A-Za-z0-9]{8,100}$/;
const SESSION=/^cs_test_[A-Za-z0-9_]{8,200}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const TABLES=Object.freeze({
  stock:/^hobbyhub-checkout-v2-sandbox-foundation-StockV2-[A-Z0-9]{8,32}$/,
  order:/^hobbyhub-checkout-v2-sandbox-foundation-OrdersV2-[A-Z0-9]{8,32}$/,
  event:/^hobbyhub-stripe-sandbox-ledgers-StripeTestEventLedger-[A-Z0-9]{8,32}$/
});
function requireReview(review,row,order){
  if(!review||review.kind!=='stripe-test-v2-inert-reconciliation'||
    review.disposition!=='RECONCILE_PAID_AND_STOCK_ATOMICALLY'||
    review.totalAuditDisposition!=='MATCHED_TEST_PAYMENT_REQUIRES_ATOMIC_RECONCILIATION'||
    review.pendingAtomicSettlement!==true||review.requiresHumanReview!==false||
    review.duplicateEvent!==false||review.executable!==false||
    review.paymentWriteAuthorized!==false||review.stockWriteAuthorized!==false||
    review.fulfillmentAuthorized!==false||review.paymentCollectionEnabled!==false||
    !EVENT.test(review.eventId||'')||!SESSION.test(review.sessionId||'')||
    !DIGEST.test(review.fingerprint||''))
    throw Error('Verified TEST-mode paid event requiring atomic settlement is missing.');
  if(!row||row.schemaVersion!==1||row.provider!=='stripe'||row.mode!=='test'||
    row.state!=='PENDING_REVIEW'||row.reviewDisposition!==review.disposition||
    row.totalAuditDisposition!==review.totalAuditDisposition||
    row.eventId!==review.eventId||row.orderId!==review.orderId||
    row.sessionId!==review.sessionId||row.fingerprint!==review.fingerprint)
    throw Error('Strongly consistent pending Stripe event receipt mismatch or already settled.');
  if(!order||order.orderId!==review.orderId||
     order.paymentMode!=='test'||order.stripeSessionId!==review.sessionId||
     order.paymentSessionId!==review.sessionId||order.shippingAddressVerified!==true||
     order.currency!=='usd'||!Number.isSafeInteger(order.totalCents)||
     order.totalCents<=0)
    throw Error('Server-owned TEST order does not match verified payment and shipment.');
}
function requireTables(stockTable,orderTable,eventTable){
  if(!TABLES.stock.test(stockTable||'')||
     !TABLES.order.test(orderTable||'')||
     !TABLES.event.test(eventTable||'')||
     new Set([stockTable,orderTable,eventTable]).size!==3)
    throw Error('Only distinct physical Checkout V2 and Stripe TEST staging tables are permitted.');
}
/**
 * Builds ONE conceptual DynamoDB TransactWriteItems batch:
 * - conditional decrement of onHand+reserved for each productId;
 * - conditional RESERVED/PENDING -> PAID order transition;
 * - conditional update of the ALREADY-PERSISTED Stripe TEST event receipt
 *   PENDING_REVIEW -> SETTLED, keyed by eventId and exact fingerprint.
 *
 * If a second webhook attempts the same order or event, conditional checks
 * on order version/status AND receipt state prevent duplicate stock capture.
 * No merchant charges or backend AWS mutation happen until a separately
 * reviewed and explicitly authorized transactional execution adapter exists.
 */
export function planStripeTestAtomicCapture({
  review,eventRow,order,stockById,now,stockTable,orderTable,eventTable
}={}){
  requireReview(review,eventRow,order);
  requireTables(stockTable,orderTable,eventTable);
  if(typeof now!=='string'||!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(now)||
     !Number.isFinite(Date.parse(now)))
    throw Error('Trusted UTC settlement timestamp required.');
  if(typeof eventRow.recordedAt!=='string' ||
     !Number.isFinite(Date.parse(eventRow.recordedAt))||
     Date.parse(now)<Date.parse(eventRow.recordedAt))
    throw Error('Settlement cannot predate persisted verified event.');
  if(!order.reservedUntil||!Number.isFinite(Date.parse(order.reservedUntil))||
     Date.parse(now)>Date.parse(order.reservedUntil))
    throw Error('Expired reservation requires manual late-payment review, not capture.');

  // Reuse the existing conservative conditional Stock V2 and Orders V2
  // transaction builder. The boolean is a pure planning marker, NOT proof
  // of a signed event; that verification belongs to the future isolated
  // trusted Lambda before it calls this pure helper.
  const base=planVerifiedReservationSettlement({
    order,stockById,outcome:'capture',now,stockTable,orderTable,
    auditTable:eventTable,evidence:{
      provider:'stripe',eventId:review.eventId,sessionId:review.sessionId,
      serverSignatureVerified:true,terminalState:'paid',
      paymentStatus:'paid',currency:'usd',amountPaidCents:order.totalCents
    }
  });
  if(base.executable!==false||base.resultingStatus!=='PAID'||
     base.transactItems.at(-1)?.Put?.TableName!==eventTable)
    throw Error('Unexpected reservation settlement plan.');
  // Replace the older planner's requestId-keyed audit Put; the new event
  // ledger is keyed by eventId and the row already exists. NEVER submit
  // an event-table Put keyed by requestId or mark an event as settled alone.
  const stockAndOrder=base.transactItems.slice(0,-1);
  const eventUpdate={Update:{
    TableName:eventTable,Key:{eventId:review.eventId},
    UpdateExpression:'SET #state = :settled, #settledAt = :now, #settledOrderVersion = :nextOrderVersion',
    ConditionExpression:[
      'attribute_exists(eventId)',
      '#state = :pending',
      '#fingerprint = :fingerprint',
      '#provider = :stripe',
      '#mode = :test',
      '#orderId = :orderId',
      '#sessionId = :sessionId',
      '#reviewDisposition = :approved',
      '#totalAuditDisposition = :matched'
    ].join(' AND '),
    ExpressionAttributeNames:{
      '#state':'state','#settledAt':'settledAt',
      '#settledOrderVersion':'settledOrderVersion',
      '#fingerprint':'fingerprint','#provider':'provider','#mode':'mode',
      '#orderId':'orderId','#sessionId':'sessionId',
      '#reviewDisposition':'reviewDisposition',
      '#totalAuditDisposition':'totalAuditDisposition'
    },
    ExpressionAttributeValues:{
      ':settled':'SETTLED',':now':new Date(now).toISOString(),
      ':nextOrderVersion':order.version+1,':pending':'PENDING_REVIEW',
      ':fingerprint':review.fingerprint,':stripe':'stripe',':test':'test',
      ':orderId':order.orderId,':sessionId':review.sessionId,
      ':approved':'RECONCILE_PAID_AND_STOCK_ATOMICALLY',
      ':matched':'MATCHED_TEST_PAYMENT_REQUIRES_ATOMIC_RECONCILIATION'
    }
  }};
  const transactItems=[...stockAndOrder,eventUpdate];
  if(transactItems.length>100 || !transactItems.every(item=>!!item.Update))
    throw Error('Non-update or oversized settlement transaction refused.');
  return Object.freeze({
    kind:'offline-stripe-test-atomic-capture-plan',
    executable:false,checkoutEnabled:false,
    paymentWriteAuthorized:false,stockWriteAuthorized:false,
    fulfillmentAuthorized:false,
    paymentEvidenceMustBeReverified:true,
    orderId:order.orderId,eventId:review.eventId,
    expectedOrderVersion:order.version,
    targetOrderStatus:'PAID',targetEventState:'SETTLED',
    transactItems
  });
}
