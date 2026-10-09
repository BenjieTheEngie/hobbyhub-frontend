/**
 * Pure, offline fulfillment transition planner. No label purchases, parcel
 * tracking calls, order mutations, Stripe events, or DynamoDB writes occur.
 * All successful production transitions MUST be authenticated, audited and
 * authorized by a separate future backend. Not a Lambda handler.
 */
export const FULFILLMENT_ACTIONS=Object.freeze([
  'START_PICKING','MARK_PACKED','MARK_SHIPPED','CONFIRM_DELIVERY'
]);
const TRANSITIONS=Object.freeze({
  START_PICKING:{from:'UNFULFILLED',to:'PICKING'},
  MARK_PACKED:{from:'PICKING',to:'PACKED'},
  MARK_SHIPPED:{from:'PACKED',to:'SHIPPED'},
  CONFIRM_DELIVERY:{from:'SHIPPED',to:'DELIVERED'}
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TRACKING=/^[A-Za-z0-9][A-Za-z0-9-]{7,59}$/;
const CARRIERS=new Set(['USPS','UPS','FEDEX']);

function validTime(value){
  if(typeof value!=='string'||!/\d{4}-\d{2}-\d{2}T/.test(value)||
     !Number.isFinite(Date.parse(value)))throw Error('A valid timestamp is required.');
  return value;
}
function requireOrder(order,expectedVersion){
  if(!order || typeof order!=='object'||!ID.test(order.orderId||''))
    throw Error('Verified order identity required.');
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1 ||
     order.version!==expectedVersion)throw Error('Order version has changed. Refresh before proceeding.');
  if(order.status!=='PAID'||order.paymentStatus!=='PAID')
    throw Error('Fulfillment requires verified paid payment and order status.');
  if(order.shippingCountry!=='US'||order.shippingMethod!=='domestic_shipping'||
     order.pickupAvailable===true)
    throw Error('Only confirmed domestic shipping orders may be fulfilled.');
  if(order.shippingAddressVerified!==true)
    throw Error('Shipping address deliverability must be verified first.');
  if(!Array.isArray(order.items)||order.items.length===0)
    throw Error('Order must contain confirmed item snapshots.');
}
function detailsForAction(order,action,evidence,now){
  if(action==='MARK_SHIPPED'){
    const carrier=String(evidence?.carrier||'').toUpperCase();
    const trackingNumber=String(evidence?.trackingNumber||'').trim().toUpperCase();
    if(!CARRIERS.has(carrier) || !TRACKING.test(trackingNumber) ||
       evidence?.labelPurchaseConfirmed!==true)
      throw Error('A confirmed purchased label, supported carrier and tracking number are required.');
    // A caller must verify label purchase on the carrier/provider's server.
    return {carrier,trackingNumber,shippedAt:now};
  }
  if(action==='CONFIRM_DELIVERY'){
    if(evidence?.carrierDeliveryVerified!==true)
      throw Error('Carrier-confirmed delivery evidence is required.');
    if(!order.carrier || !order.trackingNumber || !order.shippedAt)
      throw Error('Shipping label and shipment timestamp must already exist.');
    if(Date.parse(now)<Date.parse(validTime(order.shippedAt)))
      throw Error('Delivery timestamp cannot precede shipment.');
    return {deliveredAt:now};
  }
  if(evidence&&Object.keys(evidence).length>0)
    throw Error('Extra fulfillment evidence is not supported for this action.');
  return {};
}
export function buildFulfillmentTransition(order,{
  action,expectedVersion,requestId,actorId,now,evidence={},
  orderTable,auditTable
}={}){
  const transition=TRANSITIONS[action];
  if(!transition)throw Error('Unsupported fulfillment transition.');
  if(!UUID.test(requestId||''))throw Error('Valid idempotency ID required.');
  if(!ID.test(actorId||''))throw Error('Authorized actor ID required.');
  if(!orderTable||!auditTable||orderTable===auditTable)
    throw Error('Separate verified order and audit tables required.');
  validTime(now);
  requireOrder(order,expectedVersion);
  if(order.fulfillmentStatus!==transition.from)
    throw Error('Order is not in the expected fulfillment state.');
  const changed=detailsForAction(order,action,evidence,now);
  const normalizedRequestId=requestId.toLowerCase();
  const audit={
    requestId:normalizedRequestId,orderId:order.orderId,actorId,
    action,fromStatus:transition.from,toStatus:transition.to,
    expectedVersion,createdAt:now,
    // No shipping addresses, email addresses or payment credentials in logs.
    ...(changed.carrier?{carrier:changed.carrier}:{}),
    ...(changed.trackingNumber?{trackingNumber:changed.trackingNumber}:{}),
  };
  const names={
    '#version':'version','#paymentStatus':'paymentStatus',
    '#status':'status','#fulfillmentStatus':'fulfillmentStatus',
    '#updatedAt':'updatedAt','#shippingCountry':'shippingCountry',
    '#shippingMethod':'shippingMethod','#addressVerified':'shippingAddressVerified'
  };
  const values={
    ':expected':expectedVersion,':one':1,':paid':'PAID',
    ':before':transition.from,':after':transition.to,':now':now,
    ':us':'US',':method':'domestic_shipping',':verified':true
  };
  const updates=['#fulfillmentStatus = :after','#version = #version + :one','#updatedAt = :now'];
  for(const [field,value] of Object.entries(changed)){
    const alias='#'+field;
    names[alias]=field;values[':'+field]=value;
    updates.push(alias+' = :'+field);
  }
  const transaction={
    TransactItems:[
      {Update:{
        TableName:orderTable,Key:{orderId:order.orderId},
        ConditionExpression:'#version = :expected AND #paymentStatus = :paid AND #status = :paid AND #fulfillmentStatus = :before AND #shippingCountry = :us AND #shippingMethod = :method AND #addressVerified = :verified',
        UpdateExpression:'SET '+updates.join(', '),
        ExpressionAttributeNames:names,ExpressionAttributeValues:values
      }},
      {Put:{TableName:auditTable,Item:audit,ConditionExpression:'attribute_not_exists(requestId)'}}
    ]
  };
  return {
    orderId:order.orderId,from:transition.from,to:transition.to,
    nextVersion:expectedVersion+1,changed,audit,transaction
  };
}
