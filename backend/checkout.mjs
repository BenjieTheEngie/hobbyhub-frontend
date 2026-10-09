import {randomUUID} from 'node:crypto';
import Stripe from 'stripe';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,UpdateCommand,TransactWriteCommand,ScanCommand} from '@aws-sdk/lib-dynamodb';
import {SecretsManagerClient,GetSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import {reply,jsonBody,identityOf,isAdmin} from './security.mjs';
import {stripeCheckoutEnabled} from './guard.mjs';
import {validateCart,validatedShopItem,orderTotal,sessionLineItems,validateShipping,requireProductionSafety,classifyStripeEvent,ORDER_HOLD_SECONDS} from './checkout-logic.mjs';

const doc=DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sm=new SecretsManagerClient({});
let secretCache=null;
async function stripeClient({forCheckout=false}={}){
 if(!secretCache){
  if(!process.env.HOBBYHUB_STRIPE_SECRET_ARN||!process.env.HOBBYHUB_STRIPE_WEBHOOK_SECRET_ARN)throw new Error('Stripe sandbox Secrets Manager entries have not been configured.');
  const [key,webhook]=await Promise.all([process.env.HOBBYHUB_STRIPE_SECRET_ARN,process.env.HOBBYHUB_STRIPE_WEBHOOK_SECRET_ARN].map(SecretId=>sm.send(new GetSecretValueCommand({SecretId}))));
  secretCache={STRIPE_SECRET_KEY:key.SecretString,STRIPE_WEBHOOK_SECRET:webhook.SecretString};
 }
 if(forCheckout)requireProductionSafety({...process.env,...secretCache});
 else if(process.env.HOBBYHUB_STRIPE_TEST_ONLY!=='true'||!secretCache.STRIPE_SECRET_KEY?.startsWith('sk_test_')||!secretCache.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'))throw new Error('Only signed Stripe sandbox events are permitted.');
 return {stripe:new Stripe(secretCache.STRIPE_SECRET_KEY),webhookSecret:secretCache.STRIPE_WEBHOOK_SECRET};
}
const ordersTable=()=>process.env.HOBBYHUB_ORDERS_TABLE;
const productsTable=()=>process.env.HOBBYHUB_PRODUCTS_TABLE;
const sessionPrefix='https://checkout.stripe.com/';
function methodOf(event){return event.requestContext?.http?.method||event.httpMethod;}
function stripeErrorToReply(e){
 if(e.message && /^(Cart|Cart contains|Quantity|Duplicate|Item|Insufficient|Invalid|Product data|Order total)/.test(e.message))return reply(422,{message:e.message});
 console.error('Checkout service failure',e);return reply(503,{message:'Checkout is temporarily unavailable. Your card was not charged by this request.'});
}
async function orderRecord(orderId){return (await doc.send(new GetCommand({TableName:ordersTable(),Key:{orderId},ConsistentRead:true}))).Item;}
export async function beginCheckoutHandler(event){
 // Before parsing cart, reading Stripe secrets or reaching DynamoDB.
 if(!stripeCheckoutEnabled())return reply(503,{message:'Legacy checkout is retired. Payments are disabled.'});
 if(methodOf(event)!=='POST')return reply(405,{message:'POST required.'});
 let cart,clientOrderId;
 try{const input=jsonBody(event);cart=validateCart(input.items);clientOrderId=input.checkoutRequestId;if(clientOrderId && !/^[0-9a-f-]{36}$/.test(clientOrderId))throw new Error('Invalid checkout request ID.');}catch(e){return reply(400,{message:e.message});}
 let remoteAttempted=false,orderId;
 try{
  const {stripe}=await stripeClient({forCheckout:true});
  if(clientOrderId){
    const prior=await orderRecord(clientOrderId);
    if(prior){
      if(prior.items?.length!==cart.length||!cart.every(x=>prior.items.some(p=>p.sku===x.sku&&p.qty===x.qty)))return reply(409,{message:'This checkout attempt is already associated with another cart.'});
      if(prior.status==='RESERVED'&&prior.stripeSessionId){
        const original=await stripe.checkout.sessions.retrieve(prior.stripeSessionId);
        if(original.status==='open' && original.url?.startsWith(sessionPrefix))return reply(200,{checkoutUrl:original.url,orderId:prior.orderId,expiresAt:prior.reservedUntil});
      }
      return reply(409,{message:'Checkout attempt already exists. Wait for it to expire or create a new checkout attempt.'});
    }
  }
  const source=await Promise.all(cart.map(({sku})=>doc.send(new GetCommand({TableName:productsTable(),Key:{sku},ConsistentRead:true}))));
  const items=cart.map((line,i)=>validatedShopItem(source[i].Item,line));
  const amountSubtotal=orderTotal(items);
  const shippingCents=validateShipping(process.env.HOBBYHUB_SHIPPING_CENTS);
  orderId=clientOrderId||randomUUID();const now=Math.floor(Date.now()/1000),reservedUntil=now+ORDER_HOLD_SECONDS;
  const writes=items.map(item=>({Update:{TableName:productsTable(),Key:{sku:item.sku},UpdateExpression:'SET #q = #q - :qty',ConditionExpression:'attribute_exists(sku) AND #q >= :qty AND published = :published AND #price = :price',ExpressionAttributeNames:{'#q':'quantityOnHand','#price':'salePrice'},ExpressionAttributeValues:{':qty':item.qty,':published':true,':price':item.unitPrice}}}));
  writes.push({Put:{TableName:ordersTable(),Item:{orderId,status:'RESERVED',items,amountSubtotal,currency:'usd',createdAt:now,reservedUntil,stripeSessionId:null},ConditionExpression:'attribute_not_exists(orderId)'}});
  await doc.send(new TransactWriteCommand({TransactItems:writes,ClientRequestToken:orderId}));
  try{
   const origin=process.env.HOBBYHUB_CHECKOUT_RETURN_ORIGIN.replace(/\/$/,'');
   remoteAttempted=true;
   const session=await stripe.checkout.sessions.create({
     mode:'payment',payment_method_types:['card'],line_items:sessionLineItems(items),
     shipping_address_collection:{allowed_countries:['US']},
     shipping_options:[{shipping_rate_data:{type:'fixed_amount',fixed_amount:{amount:shippingCents,currency:'usd'},display_name:shippingCents?'Standard shipping':'Free standard shipping'}}],
     automatic_tax:{enabled:true},expires_at:reservedUntil,client_reference_id:orderId,
     metadata:{orderId},success_url:`${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${origin}/?checkout=cancel`
   },{idempotencyKey:`hobbyhub-${orderId}`});
   await doc.send(new UpdateCommand({TableName:ordersTable(),Key:{orderId},UpdateExpression:'SET stripeSessionId = :sessionId',ConditionExpression:'#status = :reserved',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':sessionId':session.id,':reserved':'RESERVED'}}));
   if(!session.url?.startsWith(sessionPrefix))throw Error('Checkout provider returned an unexpected URL.');
   return reply(200,{checkoutUrl:session.url,orderId,expiresAt:reservedUntil});
  }catch(e){
   // If a remote session was created, never release stock here. A paid webhook may still arrive.
   // Unlinked sessions need reconciliation before stock can safely be released.
   if(!remoteAttempted){try{await releaseReservation(orderId);}catch(releaseError){console.error('Unable to release failed Checkout reservation',releaseError);}}
   throw e;
  }
 }catch(e){return stripeErrorToReply(e);}
}
async function markPaid(orderId,session){
 const order=await orderRecord(orderId);
 if(!order)throw Error('Webhook order missing');
 if(order.status==='PAID'||order.status==='SHIPPED')return;
 if(order.status==='RELEASED'){
   await doc.send(new UpdateCommand({TableName:ordersTable(),Key:{orderId},UpdateExpression:'SET #s = :review, paidSessionId = :sessionId',ConditionExpression:'#s = :released',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':review':'PAID_NEEDS_MANUAL_REVIEW',':released':'RELEASED',':sessionId':session.id}}));
   console.error('PAYMENT AFTER RESERVATION RELEASE: Requires urgent fulfillment/refund review',orderId);return;
 }
 if(order.status!=='RESERVED')throw Error('Unexpected paid order state');
 await doc.send(new UpdateCommand({TableName:ordersTable(),Key:{orderId},UpdateExpression:'SET #status = :paid, paidSessionId = :sid, customerEmail = :email, shippingDetails = :shipping, amountTotal = :total, totalTax = :tax',ConditionExpression:'#status = :reserved AND (attribute_not_exists(stripeSessionId) OR stripeSessionId = :sid)',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':paid':'PAID',':sid':session.id,':email':session.customer_details?.email||'',':shipping':session.collected_information?.shipping_details||session.shipping_details||{},':total':session.amount_total||0,':tax':session.total_details?.amount_tax||0,':reserved':'RESERVED'}}));
}
async function releaseReservation(orderId, sessionId=null){
 const order=await orderRecord(orderId);
 if(!order)return;
 if(order.status!=='RESERVED')return;
 if(sessionId && order.stripeSessionId && sessionId!==order.stripeSessionId)throw Error('Stripe session ID does not match reserved order');
 const transact=order.items.map(item=>({Update:{TableName:productsTable(),Key:{sku:item.sku},UpdateExpression:'SET #stock = #stock + :qty',ConditionExpression:'attribute_exists(sku)',ExpressionAttributeNames:{'#stock':'quantityOnHand'},ExpressionAttributeValues:{':qty':item.qty}}}));
 transact.push({Update:{TableName:ordersTable(),Key:{orderId},UpdateExpression:'SET #status = :released',ConditionExpression:'#status = :reserved',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':released':'RELEASED',':reserved':'RESERVED'}}});
 await doc.send(new TransactWriteCommand({TransactItems:transact,ClientRequestToken:`rel-${orderId.slice(0,32)}`}));
}
export async function stripeWebhookHandler(event){
 // Do not mutate inventory, orders or acknowledge payment events in a
 // mistakenly deployed legacy add-on. No test/live webhook execution here.
 if(!stripeCheckoutEnabled())return reply(503,{message:'Legacy checkout webhook is disabled.'});
 if(methodOf(event)!=='POST')return reply(405,{message:'POST required.'});
 let stripe,secret;
 try{({stripe,webhookSecret:secret}=await stripeClient());}catch(e){console.error('Webhook config failure',e);return reply(503,{message:'Checkout webhook unavailable.'});}
 const buffer=event.isBase64Encoded?Buffer.from(event.body||'','base64'):Buffer.from(event.body||'','utf8');
 let payload;
 try{payload=stripe.webhooks.constructEvent(buffer,event.headers?.['stripe-signature']||event.headers?.['Stripe-Signature'],secret);}catch{return reply(400,{message:'Invalid Stripe signature.'});}
 if(payload.livemode!==false)return reply(400,{message:'Live payment events are disabled in this staging integration.'});
 const action=classifyStripeEvent(payload),session=payload.data.object,orderId=session?.metadata?.orderId;
 if(action==='ignore')return reply(200,{received:true});
 if(!orderId || !/^[0-9a-f-]{36}$/.test(orderId))return reply(400,{message:'Missing order reference.'});
 try{
  if(action==='paid')await markPaid(orderId,session);
  if(action==='release')await releaseReservation(orderId,session.id);
  return reply(200,{received:true});
 }catch(e){
  // Retry on races and transient errors; DynamoDB conditions make duplicate deliveries safe.
  if(e.name==='TransactionCanceledException'||e.name==='ConditionalCheckFailedException'){
   const order=await orderRecord(orderId).catch(()=>null);
   if(order && (action==='paid' ? order.status==='PAID'||order.status==='SHIPPED'||order.status==='PAID_NEEDS_MANUAL_REVIEW' : order.status==='RELEASED'||order.status==='PAID'||order.status==='SHIPPED'||order.status==='PAID_NEEDS_MANUAL_REVIEW'))return reply(200,{received:true});
  }
  console.error('Webhook fulfillment failure',e);return reply(503,{message:'Order processing pending retry.'});
 }
}
export async function statusHandler(event){
 if(!stripeCheckoutEnabled())return reply(503,{message:'Legacy checkout status is disabled.'});
 if(methodOf(event)!=='GET')return reply(405,{message:'GET required.'});
 const sessionId=event.queryStringParameters?.session_id;
 if(!/^cs_test_[A-Za-z0-9_]+$/.test(sessionId||''))return reply(400,{message:'Valid sandbox checkout session required.'});
 try{
  const {stripe}=await stripeClient(),session=await stripe.checkout.sessions.retrieve(sessionId);
  const orderId=session?.metadata?.orderId;
  if(!orderId)return reply(404,{message:'Order not found.'});
  const order=await orderRecord(orderId);
  if(!order)return reply(404,{message:'Order not found.'});
  return reply(200,{status:['PAID','SHIPPED'].includes(order.status)?'paid':order.status==='RELEASED'?'released':order.status==='PAID_NEEDS_MANUAL_REVIEW'?'contact_support':'processing'});
 }catch(e){console.error('Checkout status failed',e);return reply(503,{message:'Order status is temporarily unavailable.'});}
}
export async function reconcileHandler(){
 if(!stripeCheckoutEnabled())throw Error('Legacy checkout reconciliation is disabled.');
 try{
  const {stripe}=await stripeClient();
  const now=Math.floor(Date.now()/1000),result=await doc.send(new ScanCommand({TableName:ordersTable(),Limit:100}));
  let checked=0,released=0,paid=0,unlinked=0;
  for(const order of result.Items||[]){
   if(order.status!=='RESERVED'||order.reservedUntil>=now)continue;
   if(!order.stripeSessionId){console.error('UNLINKED RESERVED ORDER requires manual reconciliation',order.orderId);unlinked++;continue;}
   try{
    const session=await stripe.checkout.sessions.retrieve(order.stripeSessionId);
    if(session.payment_status==='paid'){await markPaid(order.orderId,session);paid++;}
    else if(session.status==='expired'){await releaseReservation(order.orderId,session.id);released++;}
    checked++;
   }catch(e){console.error('Order reconcile failed',order.orderId,e);}
  }
  if(result.LastEvaluatedKey)console.error('Reconciliation needs pagination; first 100 orders only checked.');
  return {checked,released,paid,unlinked};
 }catch(e){console.error('Checkout reconciliation unavailable',e);throw e;}
}

// Merchant-only order queue. This endpoint is always Cognito-JWT protected by API Gateway.
export async function adminOrdersHandler(event){
  if(!identityOf(event))return reply(401,{message:'Login required.'});
  if(!isAdmin(event))return reply(403,{message:'Administrator authorization required.'});
  if(!ordersTable())return reply(503,{message:'Orders table not configured.'});
  const method=methodOf(event),orderId=event.pathParameters?.orderId;
  try{
    if(method==='GET'){
      const data=await doc.send(new ScanCommand({TableName:ordersTable(),Limit:100}));
      if(data.LastEvaluatedKey)return reply(503,{message:'Order queue exceeds unpaginated limit; add paginated order query before scaling.'});
      return reply(200,{orders:(data.Items||[]).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))});
    }
    // Historical order shipping mutation is part of the retired checkout.
    // Read-only order operations use the separately gated order-ops service.
    if(method==='POST')return reply(503,{message:'Legacy order fulfillment is disabled.'});
    if(method==='POST' && /^[0-9a-f-]{36}$/.test(orderId||'')){
      const input=jsonBody(event),tracking=String(input.trackingNumber||'').trim(),carrier=String(input.carrier||'').trim();
      if(tracking.length>120||carrier.length>100||(!tracking && carrier))return reply(400,{message:'Shipping carrier or tracking number is invalid.'});
      await doc.send(new UpdateCommand({TableName:ordersTable(),Key:{orderId},UpdateExpression:'SET #status = :fulfilled, trackingNumber = :tracking, shippingCarrier = :carrier, fulfilledAt = :date',ConditionExpression:'#status = :paid',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':fulfilled':'SHIPPED',':paid':'PAID',':tracking':tracking,':carrier':carrier,':date':Math.floor(Date.now()/1000)}}));
      return reply(200,{status:'SHIPPED'});
    }
    return reply(405,{message:'Unsupported order operation.'});
  }catch(e){
    if(e.name==='ConditionalCheckFailedException')return reply(409,{message:'Only a paid, unfulfilled order can be marked shipped.'});
    console.error('Orders management failed',e);return reply(502,{message:'Unable to manage order at this time.'});
  }
}
