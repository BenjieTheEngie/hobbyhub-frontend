import {createHash} from 'node:crypto';
import {buildReservationTransactions} from './checkout-v2-core.mjs';

/**
 * PURE OFFLINE TRANSACTION PLANS ONLY.
 *
 * NO Stripe requests, signature verification, payment collection,
 * DynamoDB writes, reservation execution, or automatic refunds.
 *
 * The caller MUST use trusted server-side data and prove its payment provider
 * evidence independently. Never expose either function as a public endpoint.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validTable(name) {
  return typeof name==='string' && /^[A-Za-z0-9_.-]{3,255}$/.test(name);
}
function requiredDistinctTables(stockTable,orderTable,ledgerTable) {
  if(![stockTable,orderTable,ledgerTable].every(validTable) ||
      new Set([stockTable,orderTable,ledgerTable]).size!==3)
    throw Error('Three separate verified stock, orders and idempotency tables are required.');
}
function validTimestamp(value) {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
     !Number.isFinite(Date.parse(value)))
    throw Error('Valid ISO timestamp is required.');
  return Date.parse(value);
}
function expectedUUID(id,label='idempotency ID'){
  if(typeof id!=='string'||!UUID.test(id))throw Error('Valid '+label+' is required.');
  return id.toLowerCase();
}
function orderDigest(quote) {
  return createHash('sha256').update(JSON.stringify({
    requestId:quote.requestId,
    currency:quote.currency,
    subtotalCents:quote.subtotalCents,
    shippingCents:quote.shippingCents,
    shippingCountry:quote.shippingCountry,
    shippingMethod:quote.shippingMethod,
    shippingRegion:quote.shippingRegion,
    items:quote.items.map(({productId,sku,qty,unitPriceCents,lineTotalCents})=>
      ({productId,sku,qty,unitPriceCents,lineTotalCents}))
  })).digest('hex');
}

/**
 * Adds a *unique checkout request ID ledger* to a proposed conditional stock
 * reservation. Replaying a requestId with another orderId would conflict
 * atomically; the future Lambda must read the previous ledger, verify its
 * immutable quote hash and return the ORIGINAL session rather than execute a
 * new reservation. No Stripe session exists yet.
 */
export function buildIdempotentReservationPlan(quote,{
  stockTable,orderTable,idempotencyTable,orderId,now,holdUntil
}={}) {
  requiredDistinctTables(stockTable,orderTable,idempotencyTable);
  const requestId=expectedUUID(quote?.requestId,'checkout request ID');
  const base=buildReservationTransactions(quote,{stockTable,orderTable,orderId,now,holdUntil});
  const hash=orderDigest(quote);
  const ledger={
    requestId,orderId,quoteHash:hash,operation:'reserve',
    createdAt:now,reservedUntil:holdUntil,state:'RESERVED',
    // Deliberately NO TTL: retry protection must not disappear before every
    // payment outcome and provider webhook has been reconciled.
  };
  const transaction=[
    ...base.transactItems,
    {Put:{
      TableName:idempotencyTable,Item:ledger,
      ConditionExpression:'attribute_not_exists(requestId)'
    }}
  ];
  if(transaction.length>100)throw Error('Reservation transaction exceeds DynamoDB limit.');
  return {
    kind:'offline-reservation-plan',executable:false,paymentReady:false,
    order:base.order,ledger,transactItems:transaction
  };
}
export function verifyIdempotentReservationReplay(existing,proposal) {
  if(!existing || !proposal || proposal.kind!=='offline-reservation-plan')
    throw Error('A prior idempotency record and valid proposal are required.');
  if(existing.requestId!==proposal.ledger.requestId ||
     existing.orderId!==proposal.ledger.orderId ||
     existing.quoteHash!==proposal.ledger.quoteHash ||
     existing.operation!=='reserve')
    throw Error('Checkout request replay has conflicting order or cart details.');
  return {sameRequest:true,createNewReservation:false,verifiedOrderId:existing.orderId};
}
function verifyTerminalStripeEvidence(evidence,nowMillis) {
  if(!evidence || evidence.provider!=='stripe' || evidence.mode!=='test' ||
    evidence.paymentSessionExpiredVerified!==true ||
    evidence.noCapturedPaymentVerified!==true ||
    typeof evidence.eventId!=='string' || !/^evt_[A-Za-z0-9]{8,100}$/.test(evidence.eventId) ||
    validTimestamp(evidence.providerCheckedAt)>nowMillis)
    throw Error('Verified Stripe test-mode expiry and no-payment evidence is required.');
}
/**
 * The account's original legacy Inventory table is NOT a valid stockTable.
 *
 * This is NOT a user-requested cancellation operation. The future service
 * must verify a signed Stripe event and freshly read the exact order/stock
 * records, then conditionally release reserved units exactly once.
 */
export function buildExpiredReservationReleasePlan(order,stockById,{
  stockTable,orderTable,auditTable,requestId,now,
  evidence
}={}) {
  requiredDistinctTables(stockTable,orderTable,auditTable);
  const auditId=expectedUUID(requestId,'release idempotency ID');
  const checkedAt=validTimestamp(now);
  verifyTerminalStripeEvidence(evidence,checkedAt);
  if(!order || typeof order!=='object'||!ID.test(order.orderId||'') ||
     !UUID.test(order.checkoutRequestId||'') ||
     order.status!=='RESERVED' || order.paymentStatus!=='PENDING' ||
     order.fulfillmentStatus!=='UNFULFILLED' ||
     !Number.isSafeInteger(order.version) || order.version<1 ||
     order.shippingCountry!=='US' || order.shippingMethod!=='domestic_shipping'||
     order.pickupAvailable!==false || !Array.isArray(order.items)||
     order.items.length<1 || order.items.length>20)
    throw Error('Only a verified unpaid, reserved domestic order can expire.');
  const expiry=validTimestamp(order.reservedUntil);
  if(checkedAt<expiry)throw Error('Reservation has not expired yet.');
  if(!(stockById instanceof Map))throw Error('Verified current stock snapshots are required.');
  const items=[];
  const ids=new Set();
  for(const item of order.items){
    const productId=item?.productId,qty=item?.qty;
    if(!ID.test(productId||'')||ids.has(productId) ||
       !Number.isSafeInteger(qty)||qty<1||qty>20)
      throw Error('Order has malformed or duplicated product references.');
    ids.add(productId);
    const stock=stockById.get(productId);
    if(!stock||stock.productId!==productId||!Number.isSafeInteger(stock.version)||
       stock.version<1||!Number.isSafeInteger(stock.onHand)||stock.onHand<0||
       !Number.isSafeInteger(stock.reserved)||stock.reserved<qty||stock.reserved>stock.onHand)
      throw Error('Unverified stock reservation cannot be released.');
    items.push({
      Update:{
        TableName:stockTable,Key:{productId},
        UpdateExpression:'SET #reserved = #reserved - :qty, #version = #version + :one',
        ConditionExpression:'attribute_exists(productId) AND #version = :expected AND #onHand = :onHand AND #reserved >= :qty',
        ExpressionAttributeNames:{'#reserved':'reserved','#version':'version','#onHand':'onHand'},
        ExpressionAttributeValues:{
          ':qty':qty,':one':1,':expected':stock.version,':onHand':stock.onHand
        }
      }
    });
  }
  const orderUpdate={Update:{
    TableName:orderTable,Key:{orderId:order.orderId},
    UpdateExpression:'SET #status = :expired, #paymentStatus = :expired, #fulfillment = :cancelled, #version = #version + :one, #updatedAt = :now',
    ConditionExpression:'#version = :version AND #status = :reserved AND #paymentStatus = :pending AND #fulfillment = :unfulfilled AND #reservedUntil = :holdUntil',
    ExpressionAttributeNames:{
      '#version':'version','#status':'status','#paymentStatus':'paymentStatus',
      '#fulfillment':'fulfillmentStatus','#reservedUntil':'reservedUntil','#updatedAt':'updatedAt'
    },
    ExpressionAttributeValues:{
      ':version':order.version,':one':1,':reserved':'RESERVED',':pending':'PENDING',
      ':unfulfilled':'UNFULFILLED',':expired':'EXPIRED',':cancelled':'CANCELLED',
      ':holdUntil':order.reservedUntil,':now':now
    }
  }};
  const audit={requestId:auditId,orderId:order.orderId,operation:'expire-reservation',
    originalCheckoutRequestId:order.checkoutRequestId.toLowerCase(),
    paymentProvider:'stripe',paymentEventId:evidence.eventId,
    beforeStatus:'RESERVED',afterStatus:'EXPIRED',createdAt:now,
    items:order.items.map(({productId,qty})=>({productId,qty}))
  };
  const auditPut={Put:{
    TableName:auditTable,Item:audit,ConditionExpression:'attribute_not_exists(requestId)'
  }};
  const transactItems=[...items,orderUpdate,auditPut];
  if(transactItems.length>100)throw Error('Release transaction exceeds DynamoDB limit.');
  return {
    kind:'offline-reservation-release-plan',
    executable:false,requiresSignedProviderVerification:true,
    newOrderStatus:'EXPIRED',transactItems,audit
  };
}
