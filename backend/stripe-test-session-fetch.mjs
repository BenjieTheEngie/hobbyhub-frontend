import {verifyStripeSandboxEnvelope} from './stripe-sandbox-webhook-boundary.mjs';

/**
 * TEST-ONLY trusted server-side Stripe Checkout Session retrieval.
 * Source-only, no webhook Lambda/route, no deployed client or API key.
 * A real caller must instantiate the official SDK using a server-owned
 * sk_test_ secret and supply the original raw signed webhook request.
 *
 * Important: the event body is authenticated FIRST. The only permitted SDK
 * lookup ID is the signed event's test-mode cs_test_ sessionId. A client
 * request/body may never select the session to retrieve.
 */
export async function retrieveSignedStripeTestSession({
  request,stripeSdk,webhookSigningSecret
}={}){
  const signed=verifyStripeSandboxEnvelope({
    request,stripeSdk,webhookSigningSecret
  });
  const event=signed.event;
  if(typeof stripeSdk?.checkout?.sessions?.retrieve!=='function')
    throw Error('Trusted server-only Stripe Checkout Session retrieval is required.');
  const session=await stripeSdk.checkout.sessions.retrieve(event.sessionId);
  if(!session||session.object!=='checkout.session'||session.livemode!==false||
     session.mode!=='payment'||session.id!==event.sessionId||
     session.client_reference_id!==event.orderId||
     session.metadata?.orderId!==event.orderId||
     session.currency!=='usd')
    throw Error('Retrieved Stripe TEST Checkout Session does not match signed provider reference.');
  // This function returns internal trusted provider data, which can include
  // address/customer information. Never forward it to the browser or logs.
  return Object.freeze({event,session});
}
