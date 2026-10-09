import {SecretsManagerClient,GetSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import {reply,jsonBody,identityOf,isAdmin} from './security.mjs';
import {requestEasyPostTestRates} from './easypost-test-rates.mjs';

const secrets=new SecretsManagerClient({});
/**
 * ADMIN-ONLY test-rate preview endpoint. It never takes a cart price, buys a
 * label, collects a payment or changes an order. Not a customer checkout API.
 * Store {apiKey:"EZTK...",origin:{recipient,line1,city,state,postalCode,country}}
 * in a dedicated Secrets Manager secret; no key is sent to Vercel.
 */
export async function carrierRatePreviewHandler(event){
  if(!identityOf(event))return reply(401,{message:'Admin sign-in required.'});
  if(!isAdmin(event))return reply(403,{message:'Admin privileges required.'});
  if((event.requestContext?.http?.method||event.httpMethod)!=='POST')
    return reply(405,{message:'Only POST carrier preview requests are supported.'});
  if(process.env.HOBBYHUB_CARRIER_PREVIEW_ENABLED!=='true')
    return reply(503,{message:'Carrier test-rate preview is disabled.'});
  const arn=process.env.HOBBYHUB_CARRIER_TEST_SECRET_ARN;
  if(!arn || !arn.startsWith('arn:aws:secretsmanager:'))
    return reply(503,{message:'Test carrier credentials and ship-from details are not configured.'});
  if(typeof event.body!=='string'||event.body.length>5000)
    return reply(413,{message:'Shipping request is too large.'});
  let input;
  try {input=jsonBody(event);}catch{return reply(400,{message:'Valid shipping details are required.'});}
  // Do not accept client origin, rate, price, pickup or international overrides.
  if(Object.keys(input).some(k=>!['destination','parcel'].includes(k)))
    return reply(400,{message:'Only destination and measured parcel are accepted.'});
  try{
    const response=await secrets.send(new GetSecretValueCommand({SecretId:arn}));
    const config=JSON.parse(response.SecretString||'{}');
    const rated=await requestEasyPostTestRates({
      apiKey:config.apiKey,origin:config.origin,
      destination:input.destination,parcel:input.parcel,
    });
    return reply(200,{provider:'easypost',mode:'test',rateOnly:true,labelPurchased:false,
      checkoutEnabled:false,options:rated.options});
  }catch(e){
    // Never log addresses, parcel recipients, secret keys, provider bodies.
    console.error('Rate preview could not be verified',e?.name||'Unknown');
    return reply(503,{message:'Test carrier rate preview unavailable. No quote, purchase, or payment was made.'});
  }
}
