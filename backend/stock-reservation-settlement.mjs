/**
 * OFFLINE design for conditional reservation settlement. This module has no
 * AWS SDK, Stripe client, API entrypoint, or side effects.
 *
 * These plans MUST NOT be executed until a signed Stripe webhook verifies
 * each payment/terminal event and the transaction-ID ledger is deployed.
 * Caller cannot prove authenticity merely by setting a boolean in JSON.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EVENT=/^evt_[A-Za-z0-9]{8,100}$/;
const SESSION=/^cs_(?:test|live)_[A-Za-z0-9]{8,150}$/;
const MAX_LINES=20;
function checkOrder(order){
  if(!order||!ID.test(order.orderId||'')||
    order.status!=='RESERVED'||order.paymentStatus!=='PENDING'||
    order.fulfillmentStatus!=='UNFULFILLED'||
    order.shippingCountry!=='US'||order.shippingMethod!=='domestic_shipping'||
    order.pickupAvailable!==false||
    !Number.isSafeInteger(order.version)||order.version<1||
    !SESSION.test(order.paymentSessionId||'')||
    !Array.isArray(order.items)||!order.items.length||order.items.length>MAX_LINES)
    throw Error('Only verified pending domestic reservation orders can be settled.');
  const ids=new Set();
  for(const item of order.items) {
    if(!ID.test(item?.productId||'')||!Number.isSafeInteger(item.qty)||
      item.qty<1||item.qty>20||ids.has(item.productId))
      throw Error('Order has invalid or duplicate reserved line quantities.');
    ids.add(item.productId);
  }
  return order;
}
function validateEvidence(order,evidence,outcome){
  if(!evidence||evidence.provider!=='stripe'||!EVENT.test(evidence.eventId||'')||
     evidence.sessionId!==order.paymentSessionId ||
     evidence.serverSignatureVerified!==true)
    throw Error('Signed matching provider event is required to settle reserved stock.');
  // NOTE: boolean verification is only a *planning* marker. The actual Lambda
  // must independently verify Stripe-Signature using the raw request body.
  if(outcome==='release'){
    if(!['expired','failed','canceled'].includes(evidence.terminalState))
      throw Error('Only provider-confirmed terminal failures can release stock.');
  }else{
    if(evidence.terminalState!=='paid'||evidence.paymentStatus!=='paid'||
       evidence.currency!=='usd'||!Number.isSafeInteger(order.totalCents)||
       order.totalCents<=0 || !Number.isSafeInteger(order.taxCents)||order.taxCents<0 ||
       evidence.amountPaidCents!==order.totalCents)
      throw Error('Confirmed paid USD amount and finalized order tax/total are required.');
  }
}
function stockUpdate(item,stock,stockTable,outcome,now){
  if(!stock||stock.productId!==item.productId||
    !Number.isSafeInteger(stock.version)||stock.version<1||
    !Number.isSafeInteger(stock.onHand)||stock.onHand<item.qty||
    !Number.isSafeInteger(stock.reserved)||stock.reserved<item.qty||
    stock.reserved>stock.onHand)
    throw Error('Verified reserved stock balance is unavailable for settlement.');
  const names={'#reserved':'reserved','#version':'version','#onHand':'onHand','#updatedAt':'updatedAt'};
  const values={':qty':item.qty,':one':1,':version':stock.version,
    ':onHand':stock.onHand,':reserved':stock.reserved,':now':now};
  return {Update:{
    TableName:stockTable,Key:{productId:item.productId},
    UpdateExpression:outcome==='capture'
      ?'SET #onHand = #onHand - :qty, #reserved = #reserved - :qty, #version = #version + :one, #updatedAt = :now'
      :'SET #reserved = #reserved - :qty, #version = #version + :one, #updatedAt = :now',
    ConditionExpression:'attribute_exists(productId) AND #version = :version AND #onHand = :onHand AND #reserved = :reserved',
    ExpressionAttributeNames:names,ExpressionAttributeValues:values
  }};
}
export function planVerifiedReservationSettlement({
  order,stockById,evidence,outcome,now,stockTable,orderTable,auditTable
}={}) {
  if(!['release','capture'].includes(outcome))
    throw Error('Settlement must be release or capture.');
  checkOrder(order);
  validateEvidence(order,evidence,outcome);
  if(!(stockById instanceof Map)||!stockTable||!orderTable||!auditTable||
     stockTable===orderTable||stockTable===auditTable||orderTable===auditTable)
    throw Error('Independent strongly consistent stock snapshot and distinct tables required.');
  if(typeof now!=='string'||!Number.isFinite(Date.parse(now)))
    throw Error('Verified settlement timestamp required.');
  const writes=order.items.map(item=>stockUpdate(item,stockById.get(item.productId),stockTable,outcome,now));
  const status=outcome==='capture'?'PAID':'RELEASED';
  const payment=outcome==='capture'?'PAID':'CANCELLED';
  const names={'#version':'version','#status':'status','#payment':'paymentStatus',
    '#fulfillment':'fulfillmentStatus','#sessionId':'paymentSessionId',
    '#updatedAt':'updatedAt','#paymentEventId':'paymentEventId'};
  const vals={':version':order.version,':one':1,':reserved':'RESERVED',
    ':pending':'PENDING',':unfulfilled':'UNFULFILLED',':sessionId':order.paymentSessionId,
    ':status':status,':payment':payment,':fulfillment':outcome==='capture'?'UNFULFILLED':'CANCELLED',
    ':now':now,':eventId':evidence.eventId};
  const orderUpdate={Update:{
    TableName:orderTable,Key:{orderId:order.orderId},
    UpdateExpression:'SET #status = :status, #payment = :payment, #fulfillment = :fulfillment, #version = #version + :one, #updatedAt = :now, #paymentEventId = :eventId',
    ConditionExpression:'#status = :reserved AND #payment = :pending AND #fulfillment = :unfulfilled AND #version = :version AND #sessionId = :sessionId',
    ExpressionAttributeNames:names,ExpressionAttributeValues:vals
  }};
  const audit={
    requestId:evidence.eventId,orderId:order.orderId,operation:'reservation-'+outcome,
    provider:'stripe',providerSessionId:order.paymentSessionId,
    itemCount:order.items.reduce((n,x)=>n+x.qty,0),
    orderVersion:order.version,createdAt:now
  };
  const auditPut={Put:{
    TableName:auditTable,Item:audit,
    ConditionExpression:'attribute_not_exists(requestId)'
  }};
  if(writes.length+2>100)throw Error('Reservation settlement transaction too large.');
  return {
    kind:'offline-only-reservation-settlement',
    executable:false,requiresSignedProviderWebhook:true,
    outcome,orderId:order.orderId,expectedOrderVersion:order.version,
    resultingStatus:status,orderChanges:{status,paymentStatus:payment,
      fulfillmentStatus:vals[':fulfillment'],nextVersion:order.version+1},
    audit,transactItems:[...writes,orderUpdate,auditPut]
  };
}
