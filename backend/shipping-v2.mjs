/**
 * Merchant-approved shipping policy: United States (50 states + DC), delivery
 * only. No local pickup, international, U.S. territories or military mail in
 * this initial checkout design. This is NOT a postal address verification API.
 */
export const SHIPPING_METHOD='domestic_shipping';
export const SHIPPING_COUNTRY='US';
export const US_CONTIGUOUS_STATES=Object.freeze([
  'AL','AZ','AR','CA','CO','CT','DE','FL','GA','ID','IL','IN','IA','KS','KY',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
  'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC'
]);
export const ALLOWED_US_STATES=Object.freeze([...US_CONTIGUOUS_STATES,'AK','HI']);
const allowedStates=new Set(ALLOWED_US_STATES);
const contiguous=new Set(US_CONTIGUOUS_STATES);
const postal=/^[0-9]{5}(?:-[0-9]{4})?$/;
const fields=['recipient','line1','line2','city','state','postalCode','country'];

function safeAddressText(value,name,{max=120,required=true}={}){
  if(typeof value!=='string')throw Error(name+' must be text.');
  const v=value.trim().replace(/\s+/g,' ');
  if(required && !v)throw Error(name+' is required.');
  if(v.length>max || /[\u0000-\u001f\u007f]/.test(v))throw Error(name+' contains unsupported characters or is too long.');
  return v;
}
/** Do not place full customer addresses in application logs, URLs or exports. */
export function validateUSShippingAddress(input) {
  if(!input || typeof input!=='object' || Array.isArray(input))
    throw Error('A physical U.S. shipping address is required.');
  for(const key of Object.keys(input))
    if(!fields.includes(key))throw Error('Shipping address includes an unsupported field.');
  const country=safeAddressText(input.country,'Country',{max:2}).toUpperCase();
  if(country!==SHIPPING_COUNTRY)throw Error('International shipping is not available.');
  const state=safeAddressText(input.state,'State',{max:2}).toUpperCase();
  if(!allowedStates.has(state))throw Error('Shipping is limited to the 50 states and Washington, DC.');
  const zip=safeAddressText(input.postalCode,'ZIP code',{max:10});
  if(!postal.test(zip))throw Error('A valid 5- or 9-digit U.S. ZIP code is required.');
  const recipient=safeAddressText(input.recipient,'Recipient',{max:120});
  const line1=safeAddressText(input.line1,'Address line 1',{max:160});
  const line2=input.line2==null?'':safeAddressText(input.line2,'Address line 2',{max:160,required:false});
  const city=safeAddressText(input.city,'City',{max:100});
  return {recipient,line1,line2,city,state,postalCode:zip,country};
}
export function shippingRegion(state){
  if(state==='AK')return 'alaska';
  if(state==='HI')return 'hawaii';
  if(contiguous.has(state))return 'contiguous';
  throw Error('Shipping region is not supported.');
}
const RATE_REGIONS=['contiguous','alaska','hawaii'];
const MAX_SHIPPING_CENTS=50000;

/**
 * Rates are merchant supplied or verified carrier quotes. Missing rates FAIL
 * CLOSED. We never guess a USPS/UPS price or promise transit times.
 */
export function validateShippingRates(config) {
  if(!config || typeof config!=='object' || Array.isArray(config))
    throw Error('Approved shipping rates have not been configured.');
  if(config.method!==SHIPPING_METHOD || config.country!==SHIPPING_COUNTRY ||
      config.pickupEnabled!==false)
    throw Error('Shipping policy must be U.S.-only with local pickup disabled.');
  if(!config.ratesCents || typeof config.ratesCents!=='object' ||
     Array.isArray(config.ratesCents))throw Error('Approved domestic shipping rates are missing.');
  const ratesCents={};
  for(const region of RATE_REGIONS){
    const value=config.ratesCents[region];
    if(!Number.isSafeInteger(value)||value<0||value>MAX_SHIPPING_CENTS)
      throw Error('Shipping rate for '+region+' must be explicitly approved in cents.');
    ratesCents[region]=value;
  }
  if(Object.keys(config.ratesCents).some(k=>!RATE_REGIONS.includes(k)))
    throw Error('Unsupported shipping-rate region.');
  if(config.approved!==true)throw Error('Shipping rates must be approved by the merchant.');
  return {method:SHIPPING_METHOD,country:SHIPPING_COUNTRY,pickupEnabled:false,ratesCents,approved:true};
}
export function quoteDomesticShipping(addressInput,config) {
  const address=validateUSShippingAddress(addressInput);
  const rates=validateShippingRates(config);
  const region=shippingRegion(address.state);
  return {
    method:SHIPPING_METHOD,country:SHIPPING_COUNTRY,region,
    shippingCents:rates.ratesCents[region],
    pickupAvailable:false,
    destination:{state:address.state,postalCode:address.postalCode},
    addressVerified:false, // formatting check ≠ USPS address deliverability
    carrier:null,service:null,deliveryEstimate:null,
  };
}
export function composePrecheckoutTotals(quote,shippingQuote) {
  if(!quote || quote.checkoutReady!==false || quote.currency!=='usd' ||
      !Number.isSafeInteger(quote.subtotalCents)||quote.subtotalCents<=0 ||
      !Array.isArray(quote.items)||quote.items.length===0)
    throw Error('Verified product quote is required.');
  if(!shippingQuote || shippingQuote.method!==SHIPPING_METHOD ||
      shippingQuote.country!=='US' || shippingQuote.pickupAvailable!==false ||
      !Number.isSafeInteger(shippingQuote.shippingCents) ||
      shippingQuote.shippingCents<0 || shippingQuote.shippingCents>MAX_SHIPPING_CENTS)
    throw Error('Approved domestic shipping quote required.');
  const preTaxCents=quote.subtotalCents+shippingQuote.shippingCents;
  if(!Number.isSafeInteger(preTaxCents)||preTaxCents>100000000)
    throw Error('Pre-tax quote exceeds allowed limit.');
  // Tax remains unknown until verified by the backend/Stripe tax integration.
  // Never represent pre-tax subtotal as the final amount charged.
  return {...quote,shippingMethod:SHIPPING_METHOD,shippingCountry:'US',
    shippingRegion:shippingQuote.region,shippingCents:shippingQuote.shippingCents,
    preTaxCents,taxCents:null,totalCents:null,checkoutReady:false,
    pickupAvailable:false,shippingAddressVerified:false};
}
