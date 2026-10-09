/**
 * Stripe Checkout V2 — SIGNATURE BOUNDARY, TEST ONLY.
 * Source-only adapter, NOT an AWS Lambda handler or route.
 * Trusted server code must obtain TEST signing secret from Secrets Manager
 * and instantiate official Stripe SDK. Never authenticate via caller boolean.
 * The returned normalized envelope is inert data: no Stripe or AWS writes.
 */
const ALLOWED_TYPES=new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired'
]);
const SESSION_ID=/^cs_test_[A-Za-z0-9_]{8,200}$/;
const ORDER_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EVENT_ID=/^evt_[A-Za-z0-9]{8,100}$/;
const MAX_BODY_BYTES=256*1024;
const SIGNATURE_TOLERANCE_SECONDS=300;
function signatureHeader(request) {
  const entries=[];
  for(const source of [request?.headers,request?.multiValueHeaders]){
    if(!source||typeof source!=='object'||Array.isArray(source))continue;
    for(const [name,value] of Object.entries(source)){
      if(name.toLowerCase()!=='stripe-signature')continue;
      if(Array.isArray(value)){
        if(value.length!==1)throw Error('Ambiguous Stripe signature header.');
        entries.push(value[0]);
      }else entries.push(value);
    }
  }
  if(entries.length!==1 || typeof entries[0]!=='string'||
     !entries[0].trim() || entries[0].length>2048)
    throw Error('Exactly one Stripe signature header is required.');
  return entries[0];
}
function exactRawBody(request){
  const text=request?.body;
  if(typeof text!=='string'||!text.length||text.length>MAX_BODY_BYTES*2)
    throw Error('Raw Stripe request body is missing or oversized.');
  let raw;
  if(request.isBase64Encoded===true){
    if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))
      throw Error('Malformed Stripe base64 body.');
    raw=Buffer.from(text,'base64');
    if(raw.toString('base64')!==text)throw Error('Noncanonical Stripe base64 body.');
  }else if(request.isBase64Encoded===false || request.isBase64Encoded===undefined){
    raw=Buffer.from(text,'utf8');
  }else throw Error('Invalid Stripe payload encoding.');
  if(!raw.length||raw.length>MAX_BODY_BYTES)
    throw Error('Raw Stripe body exceeds webhook size limit.');
  return raw;
}
function methodIsPost(request){
  return (request?.requestContext?.http?.method||request?.httpMethod)==='POST';
}
function normalizeSession(event){
  if(!EVENT_ID.test(event?.id||'')||event.livemode!==false||
     !ALLOWED_TYPES.has(event.type))
    throw Error('Only allowed Stripe sandbox Checkout events are supported.');
  const s=event.data?.object;
  if(!s||s.object!=='checkout.session'||s.livemode!==false||
     !SESSION_ID.test(s.id||''))
    throw Error('Expected a genuine test-mode Checkout session.');
  if(!ORDER_ID.test(s.metadata?.orderId||'')||s.client_reference_id!==s.metadata.orderId)
    throw Error('Immutable order reference must match signed session metadata and client reference.');
  if(s.mode!=='payment'||s.currency!=='usd'||
     !Number.isSafeInteger(s.amount_total)||s.amount_total<0||
     s.amount_total>5_100_000||!['paid','unpaid','no_payment_required'].includes(s.payment_status))
    throw Error('Verified USD payment-mode Checkout session required.');
  // Customer PII, address, card information and secrets are not copied.
  return Object.freeze({
    eventId:event.id,type:event.type,mode:'test',sessionId:s.id,
    orderId:s.metadata.orderId,paymentStatus:s.payment_status,
    amountTotalCents:s.amount_total,currency:'usd'
  });
}
/**
 * stripeSdk must be a trusted server-owned official Stripe client. This
 * boundary accepts its SDK verifier for dependency-injected offline tests.
 * Do NOT pass any verifier or signing-secret argument from public requests.
 */
export function verifyStripeSandboxEnvelope({
  request,stripeSdk,webhookSigningSecret
}={}){
  if(!methodIsPost(request))throw Error('Stripe webhook requires POST.');
  if(typeof webhookSigningSecret!=='string'||!webhookSigningSecret.startsWith('whsec_')||
     webhookSigningSecret.length<12)
    throw Error('Configured sandbox webhook signing secret is required.');
  if(typeof stripeSdk?.webhooks?.constructEvent!=='function')
    throw Error('The official Stripe SDK webhook verifier is required.');
  const header=signatureHeader(request);
  const raw=exactRawBody(request);
  // Stripe SDK verifies HMAC and signed timestamp, never JSON.parse the body.
  const signed=stripeSdk.webhooks.constructEvent(
    raw,header,webhookSigningSecret,SIGNATURE_TOLERANCE_SECONDS
  );
  const normalized=normalizeSession(signed);
  return Object.freeze({
    event:normalized,
    trust:Object.freeze({signatureVerified:true,verifiedBy:'stripe-sdk-raw-body'}),
    executionAllowed:false,paymentWriteAuthorized:false,
    fulfillmentAuthorized:false,stockWriteAuthorized:false
  });
}
