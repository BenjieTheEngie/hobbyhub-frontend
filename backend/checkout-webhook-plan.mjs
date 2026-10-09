/**
 * PURE test-mode Stripe Checkout event transition plan — NEVER a webhook handler.
 * A future server MUST verify Stripe's raw-body signature and correct endpoint
 * secret before invoking this model; a boolean cannot itself verify a signature.
 *
 * This model cannot collect payments, publish products, call DynamoDB, release
 * reservations, buy labels, or fulfill orders. It creates an offline
 * transaction proposal only when a server-verified test event precisely matches
 * an existing, funded, known-total, US domestic shipping order.
 */
const EVENT_ID=/^evt_[A-Za-z0-9]{8,100}$/;
const SESSION_ID=/^cs_test_[A-Za-z0-9]{8,200}$/;
const INTENT_ID=/^pi_[A-Za-z0-9]{8,100}$/;
const ORDER_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TYPES=new Set(['checkout.session.completed','checkout.session.async_payment_succeeded']);

export function decideTestCheckoutEvent({event,order,signatureVerified=false,now}={}) {
  if(signatureVerified!==true)throw Error('Signed Stripe event must be verified by trusted server before any payment decision.');
  if(!event||!EVENT_ID.test(event.id||'')||event.livemode!==false||
     !['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired'].includes(event.type))
    throw Error('Unsupported or non-test Stripe Checkout event.');
  if(typeof now!=='string'||!Number.isFinite(Date.parse(now)))
    throw Error('Server timestamp required.');
  const session=event.data?.object;
  if(!session||session.object!=='checkout.session'||session.livemode!==false||
    !SESSION_ID.test(session.id||''))
    throw Error('A verified test Checkout session is required.');
  if(!order||!ORDER_ID.test(order.orderId||'')||order.stripeSessionId!==session.id||
     session.metadata?.orderId!==order.orderId)
    throw Error('Stripe session and immutable order identity do not match.');
  if(order.shippingCountry!=='US'||order.shippingMethod!=='domestic_shipping'||
     order.pickupAvailable!==false)
    throw Error('Non-domestic or pickup order cannot be paid through Hobby Hub.');
  if(order.testMode!==true)throw Error('Only test-mode orders are supported by the offline planner.');
  if(order.paymentStatus!=='PENDING'||order.status!=='RESERVED')
    return {action:'review-existing-order',writeAllowed:false,reason:'Order no longer pending; verify previous event processing.',eventId:event.id};
  if(event.type==='checkout.session.expired')
    return {action:'reconciliation-required',writeAllowed:false,reason:'Expired session needs verified payment status and idempotent stock release.',eventId:event.id};
  if(!TYPES.has(event.type))throw Error('Unsupported Stripe Checkout transition.');
  if(session.payment_status!=='paid')
    return {action:'wait-for-payment',writeAllowed:false,reason:'Session completed without verified paid status.',eventId:event.id};
  if(session.currency!=='usd'||order.currency!=='usd'||
    !Number.isSafeInteger(session.amount_total)||session.amount_total<1||
    !Number.isSafeInteger(order.totalCents)||order.totalCents<1||
    session.amount_total!==order.totalCents)
    throw Error('Stripe paid amount or currency does not equal the server-approved final order total.');
  if(!INTENT_ID.test(session.payment_intent||''))
    throw Error('Verified payment intent required.');
  if(!Number.isSafeInteger(order.version)||order.version<1)
    throw Error('Verified order version required.');
  if(typeof order.reservedUntil!=='string'||!Number.isFinite(Date.parse(order.reservedUntil)) ||
     Date.parse(now)>Date.parse(order.reservedUntil))
    return {action:'reconciliation-required',writeAllowed:false,
      reason:'Late payment requires stock/payment reconciliation before fulfillment.',eventId:event.id};
  if(!Array.isArray(order.items)||!order.items.length)
    throw Error('Paid order has no verified item snapshots.');
  return {action:'confirm-test-payment',writeAllowed:false, // planner only: no execution capability
    orderId:order.orderId,eventId:event.id,expectedVersion:order.version,
    sessionId:session.id,paymentIntentId:session.payment_intent,
    amountCents:session.amount_total,occurredAt:now,mode:'test'};
}

/** Transaction is inert data; do not execute until signed-webhook end-to-end review. */
export function proposeTestPaidTransaction(decision,{orderTable,eventTable}={}){
  if(decision?.action!=='confirm-test-payment'||decision?.writeAllowed!==false||
     decision.mode!=='test'||!orderTable||!eventTable||orderTable===eventTable)
    throw Error('Valid non-executable test paid decision and separate tables are required.');
  const names={
    '#status':'status','#paymentStatus':'paymentStatus','#version':'version',
    '#totalCents':'totalCents','#stripeSessionId':'stripeSessionId',
    '#shippingCountry':'shippingCountry','#shippingMethod':'shippingMethod',
    '#pickupAvailable':'pickupAvailable','#paidAt':'paidAt',
    '#paymentIntentId':'paymentIntentId','#updatedAt':'updatedAt'
  };
  const values={
    ':reserved':'RESERVED',':pending':'PENDING',':paid':'PAID',':expected':decision.expectedVersion,
    ':one':1,':total':decision.amountCents,':session':decision.sessionId,
    ':us':'US',':shipping':'domestic_shipping',':noPickup':false,
    ':paidAt':decision.occurredAt,':paymentIntentId':decision.paymentIntentId
  };
  const audit={
    eventId:decision.eventId,orderId:decision.orderId,
    eventType:'checkout.session.paid',paymentIntentId:decision.paymentIntentId,
    amountCents:decision.amountCents,currency:'usd',mode:'test',createdAt:decision.occurredAt
  };
  return {executable:false,requiresStripeSignatureVerification:true,
    requiresOwnerApproval:true,mode:'test',transaction:{
      TransactItems:[
        {Update:{
          TableName:orderTable,Key:{orderId:decision.orderId},
          ConditionExpression:'#version = :expected AND #status = :reserved AND #paymentStatus = :pending AND #totalCents = :total AND #stripeSessionId = :session AND #shippingCountry = :us AND #shippingMethod = :shipping AND #pickupAvailable = :noPickup',
          UpdateExpression:'SET #status = :paid, #paymentStatus = :paid, #version = #version + :one, #paidAt = :paidAt, #paymentIntentId = :paymentIntentId, #updatedAt = :paidAt',
          ExpressionAttributeNames:names,ExpressionAttributeValues:values
        }},
        {Put:{TableName:eventTable,Item:audit,ConditionExpression:'attribute_not_exists(eventId)'}}
      ]
    }};
}
