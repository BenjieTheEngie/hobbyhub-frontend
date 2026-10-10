import {
  validateUSShippingAddress,shippingRegion,composePrecheckoutTotals
} from './shipping-v2.mjs';
import {shippingDestinationHmac} from './stripe-shipping-bind.mjs';
import {validatedPackedParcel,MAX_PARCELS_PER_ORDER} from './carrier-rating-v2.mjs';

/**
 * OFFLINE, NON-EXECUTABLE carrier commitment constructor.
 *
 * Only a future trusted server must call this with authoritative product,
 * measured packing and authenticated provider-rate snapshots, plus a real
 * server-owned HMAC key and independently confirmed address deliverability.
 * This module CANNOT authenticate a carrier API response or authorize payment.
 * It performs NO network requests, AWS writes, label purchases or Stripe calls.
 */
const RATE_ID=/^rate_[A-Za-z0-9]{8,80}$/;
const SERVICE=/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
const CARRIERS=new Set(['USPS','UPS','FEDEX']);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function utc(value,label){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)||
    !Number.isFinite(Date.parse(value)))
    throw Error('Trusted UTC '+label+' is required.');
  return Date.parse(value);
}
function claimedQuoteAndParcels(quote,parcels){
  if(!quote||quote.checkoutReady!==false||quote.currency!=='usd'||
    quote.totalCents!==null||quote.taxCents!==null||
    quote.shippingCents!==null||!Number.isSafeInteger(quote.subtotalCents)||
    quote.subtotalCents<1||quote.subtotalCents>5_000_000||
    !Array.isArray(quote.items)||quote.items.length<1||quote.items.length>20||
    !Array.isArray(parcels))
    throw Error('Complete server-priced pre-shipping quote and measured parcels are required.');
  let units=0,subtotal=0;
  const products=new Set();
  const expected=[];
  for(const line of quote.items){
    if(!ID.test(line?.productId||'')||products.has(line.productId)||
      !Number.isSafeInteger(line.qty)||line.qty<1||line.qty>20||
      !Number.isSafeInteger(line.unitPriceCents)||line.unitPriceCents<1||
      !Number.isSafeInteger(line.lineTotalCents)||
      line.lineTotalCents!==line.qty*line.unitPriceCents)
      throw Error('Invalid authoritative product and quantity snapshot.');
    products.add(line.productId);
    subtotal+=line.lineTotalCents;
    units+=line.qty;
    for(let unit=1;unit<=line.qty;unit++)expected.push({productId:line.productId,unit});
  }
  if(subtotal!==quote.subtotalCents||units<1||units>MAX_PARCELS_PER_ORDER||
    parcels.length!==units)
    throw Error('Every sold physical unit needs one measured carrier-rated parcel.');
  for(let i=0;i<units;i++){
    const p=parcels[i],identity=expected[i];
    if(p?.productId!==identity.productId||p?.unit!==identity.unit)
      throw Error('Measured parcel identities do not match order item units.');
    validatedPackedParcel(p);
  }
  return expected;
}
function selectedRates(expected,selected){
  if(!Array.isArray(selected)||selected.length!==expected.length)
    throw Error('Exactly one chosen live provider rate is required per measured parcel.');
  const seen=new Set();
  let total=0;
  const details=[];
  for(let i=0;i<selected.length;i++){
    const r=selected[i],identity=expected[i];
    if(!r||r.productId!==identity.productId||r.unit!==identity.unit||
      r.provider!=='easypost'||r.mode!=='live'||
      !CARRIERS.has(r.carrier)||!SERVICE.test(r.service||'')||
      !RATE_ID.test(r.rateId||'')||seen.has(r.rateId)||
      r.currency!=='usd'||
      !Number.isSafeInteger(r.shippingCents)||r.shippingCents<1||
      r.shippingCents>50000)
      throw Error('Each physical parcel needs a unique authenticated live USD carrier rate.');
    seen.add(r.rateId);
    total+=r.shippingCents;
    details.push(Object.freeze({rateId:r.rateId,shippingCents:r.shippingCents}));
  }
  if(total<1||total>50000||!Number.isSafeInteger(total))
    throw Error('Aggregate verified shipping quote exceeds merchant checkout limits.');
  return {total,details};
}
export function composeOfflineLiveCarrierCommitment({
  productQuote,measuredParcels,selectedRates:providerRates,
  destination,destinationSigningKey,addressDeliverabilityVerified,
  checkedAt,holdUntil,carrierQuoteExpiresAt
}={}){
  // No rate lookup and no trust obtained from a user-supplied boolean: this
  // only checks a trusted server's own already-verified snapshots.
  if(addressDeliverabilityVerified!==true)
    throw Error('A trusted independently confirmed deliverable address is required.');
  const checked=utc(checkedAt,'carrier approval time'),
    hold=utc(holdUntil,'reservation expiry'),
    rateExpiry=utc(carrierQuoteExpiresAt,'carrier rate expiry');
  if(hold<=checked||rateExpiry<=hold)
    throw Error('Carrier rates must remain valid beyond the full reservation hold.');
  const expected=claimedQuoteAndParcels(productQuote,measuredParcels);
  const {total,details}=selectedRates(expected,providerRates);
  const verifiedAddress=validateUSShippingAddress(destination);
  const digest=shippingDestinationHmac(verifiedAddress,destinationSigningKey);
  const base=composePrecheckoutTotals(productQuote,{
    method:'domestic_shipping',country:'US',pickupAvailable:false,
    region:shippingRegion(verifiedAddress.state),addressVerified:false,
    shippingCents:total
  });
  return Object.freeze({
    ...base,
    // The model remains non-executable. A future backend still MUST attest
    // provider authentication, order authority, tax and stock independently.
    rateProvider:'easypost',rateMode:'live',
    carrierRateConfirmedForPayment:true,
    shippingAddressVerified:true,
    shippingState:verifiedAddress.state,
    shippingDestinationDigest:digest,
    carrierQuoteExpiresAt:new Date(rateExpiry).toISOString(),
    carrierRateIds:details.map(x=>x.rateId),
    carrierRateDetails:details,
    ratedParcelCount:details.length,
    checkoutReady:false,paymentReady:false,executable:false
  });
}
