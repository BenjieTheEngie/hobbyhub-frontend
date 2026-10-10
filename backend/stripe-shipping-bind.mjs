import {createHmac,timingSafeEqual} from 'node:crypto';

/**
 * OFFLINE Stripe / carrier address-binding primitives.
 *
 * HMAC, not an unkeyed SHA-256: shipping address data is low-entropy PII.
 * The key must be a secret 32+ byte random value kept ONLY in server-side
 * Secrets Manager. Never log keys or addresses or store them in an order.
 *
 * No carrier API, Stripe request, stock write or customer checkout here.
 */
const US_STATES=new Set([
  'AL','AZ','AR','CA','CO','CT','DE','FL','GA','ID','IL','IN','IA','KS','KY',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
  'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC','AK','HI'
]);
const DIGEST=/^hmac-v1-([0-9a-f]{64})$/;
function secretKey(key){
  if(!Buffer.isBuffer(key)||key.length<32)
    throw Error('A trusted 32-byte server-only HMAC key is required.');
  return key;
}
function clean(field,value,max=160,optional=false){
  if(optional&&(value===undefined||value===null||value===''))return '';
  if(typeof value!=='string')throw Error('Missing or unsupported shipping '+field+'.');
  const s=value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
  if((!optional&&!s)||s.length>max||/[\u0000-\u001f\u007f]/u.test(s))
    throw Error('Missing or unsupported shipping '+field+'.');
  return s;
}
/**
 * Both our carrier input (postalCode camelCase) and Stripe Checkout SDK
 * shipping address (postal_code snake_case) become identical canonical data.
 * Recipient / email are deliberately not part of the rate-bound location.
 */
export function canonicalUSShippingDestination(address){
  if(!address||typeof address!=='object'||Array.isArray(address))
    throw Error('Complete domestic shipping address is required.');
  const country=clean('country',address.country,2).toUpperCase();
  const state=clean('state',address.state,2).toUpperCase();
  const postal=clean('postal code',address.postal_code??address.postalCode,10);
  if(country!=='US'||!US_STATES.has(state)||!/^[0-9]{5}(?:-[0-9]{4})?$/.test(postal))
    throw Error('Shipping destination must be in 50 states or DC with valid ZIP.');
  const city=clean('city',address.city,100);
  const line1=clean('address line 1',address.line1,160);
  const line2=clean('address line 2',address.line2,160,true);
  return Object.freeze({country,state,postal,city,line1,line2});
}
export function shippingDestinationHmac(address,key){
  const secret=secretKey(key);
  const a=canonicalUSShippingDestination(address);
  const payload=JSON.stringify([
    'hobbyhub-verified-domestic-destination-v1',
    a.country,a.state,a.postal,a.city,a.line1,a.line2
  ]);
  return 'hmac-v1-'+createHmac('sha256',secret).update(payload,'utf8').digest('hex');
}
/** Avoid accidentally logging PII or comparing address digests with ===. */
export function verifyBoundStripeDestination(address,expectedDigest,key){
  if(typeof expectedDigest!=='string'||!DIGEST.test(expectedDigest))
    throw Error('Order has no valid carrier-approved shipping destination binding.');
  const signed=shippingDestinationHmac(address,key);
  return timingSafeEqual(Buffer.from(signed.slice(8),'hex'),Buffer.from(expectedDigest.slice(8),'hex'));
}
