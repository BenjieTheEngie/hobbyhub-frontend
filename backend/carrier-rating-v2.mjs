import {validateUSShippingAddress,shippingRegion,composePrecheckoutTotals} from './shipping-v2.mjs';

/**
 * Carrier quote domain. Dimensions in inches; weight in ounces. No default
 * package sizes or prices are fabricated. Each SKU requires a merchant-
 * measured, already-packed per-unit parcel profile, including packaging.
 * Multiple units become separate parcels until safe packing logic is built.
 */
export const MAX_PARCELS_PER_ORDER=8;
export const MAX_WEIGHT_OZ=1120; // 70 lb manual-rating boundary
export const MAX_DIMENSION_IN=48;
const decimalOne=(n)=>typeof n==='number' && Number.isFinite(n) && n>0 &&
  Math.abs(n*10-Math.round(n*10))<1e-8;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CARRIERS=new Set(['USPS','UPS','FEDEX']);
const safeService=/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

export function validatedPackedParcel(p) {
  if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Merchant-measured packed parcel is required.');
  const {lengthIn,widthIn,heightIn,weightOz}=p;
  for(const [name,num,max] of [['length',lengthIn,MAX_DIMENSION_IN],
    ['width',widthIn,MAX_DIMENSION_IN],['height',heightIn,MAX_DIMENSION_IN],
    ['weight',weightOz,MAX_WEIGHT_OZ]]){
    if(!decimalOne(num)||num>max)throw Error('Packed '+name+' must be a positive measured number (one decimal, within limits).');
  }
  return {lengthIn,widthIn,heightIn,weightOz};
}
export function prepareCarrierQuoteRequest({destination,origin,parcel}) {
  const from=validateUSShippingAddress(origin),to=validateUSShippingAddress(destination);
  const packed=validatedPackedParcel(parcel);
  return {
    fromAddress:from,toAddress:to,parcel:packed,region:shippingRegion(to.state),
    method:'domestic_shipping',country:'US',pickupAvailable:false
  };
}
export function parcelsForVerifiedCart(intent,productsById){
  if(!intent||!Array.isArray(intent.items)||!(productsById instanceof Map))
    throw Error('Verified cart and product snapshot required for packing.');
  const parcels=[];
  for(const item of intent.items){
    if(!ID.test(item?.productId||'')||!Number.isSafeInteger(item.qty)||item.qty<1||item.qty>20)
      throw Error('Invalid line quantity for shipping.');
    const product=productsById.get(item.productId);
    if(!product || product.productId!==item.productId)throw Error('Product packing metadata is missing.');
    // An admin has to weigh and measure the item *with packaging*.
    const p=validatedPackedParcel(product.shippingPackage);
    for(let i=0;i<item.qty;i++){
      if(parcels.length>=MAX_PARCELS_PER_ORDER)
        throw Error('This order requires packing review; too many individual parcels.');
      parcels.push({productId:item.productId,unit:i+1,...p});
    }
  }
  if(!parcels.length)throw Error('No verified parcels available for rating.');
  return parcels;
}
export function usdRateCents(value) {
  if(typeof value!=='string' || !/^(?:0|[1-9]\d{0,4})\.\d{2}$/.test(value))
    throw Error('Carrier rate must be an exact USD decimal string.');
  const [dollars,cents]=value.split('.');
  const n=Number(dollars)*100+Number(cents);
  if(!Number.isSafeInteger(n)||n<1||n>500000)throw Error('Carrier rate is outside allowed bounds.');
  return n;
}
export function verifiedEasyPostRateOptions(shipment) {
  if(shipment?.mode!=='test'||!Array.isArray(shipment.rates))
    throw Error('Test-mode carrier rate response is not verified.');
  const results=[];
  const seen=new Set();
  for(const r of shipment.rates){
    try{
      if(r.mode!=='test'||String(r.currency||'').toUpperCase()!=='USD')continue;
      const carrier=String(r.carrier||'').toUpperCase();
      if(!CARRIERS.has(carrier)||typeof r.service!=='string'||!safeService.test(r.service))continue;
      const shippingCents=usdRateCents(r.rate);
      const rateId=String(r.id||'');
      if(!/^rate_[A-Za-z0-9]{8,80}$/.test(rateId))continue;
      if(seen.has(rateId))continue;
      seen.add(rateId);
      results.push({
        provider:'easypost',mode:'test',carrier,service:r.service,
        rateId,shippingCents,currency:'usd',
        deliveryDays:Number.isSafeInteger(r.delivery_days)&&r.delivery_days>=0&&r.delivery_days<=45?r.delivery_days:null,
      });
    }catch { /* Drop malformed provider rates, never invent a usable price. */ }
  }
  return results.sort((a,b)=>a.shippingCents-b.shippingCents);
}
export function aggregateMultiParcelRates(ratedParcels){
  if(!Array.isArray(ratedParcels)||ratedParcels.length<1||
    ratedParcels.length>MAX_PARCELS_PER_ORDER)
    throw Error('One to eight verified parcel rate results are required.');
  const selected=[];
  let shippingCents=0;
  for(const parcel of ratedParcels){
    const opts=parcel?.options;
    if(!Array.isArray(opts)||!opts.length)throw Error('At least one parcel has no carrier rate; no final quote is available.');
    const eligible=opts.filter(rate=>rate?.provider==='easypost'&&rate?.mode==='test'&&
      CARRIERS.has(rate.carrier)&&Number.isSafeInteger(rate.shippingCents)&&
      rate.shippingCents>=1&&rate.shippingCents<=500000);
    if(!eligible.length)throw Error('Unverified carrier rate cannot be used.');
    const best=eligible.reduce((a,b)=>a.shippingCents<=b.shippingCents?a:b);
    if(best.provider!=='easypost'||best.mode!=='test'||!CARRIERS.has(best.carrier)||
      !Number.isSafeInteger(best.shippingCents)||best.shippingCents<1)
      throw Error('Unverified carrier rate cannot be used.');
    selected.push({...best,productId:parcel.productId||null,unit:parcel.unit??null});
    shippingCents+=best.shippingCents;
  }
  if(!Number.isSafeInteger(shippingCents)||shippingCents>500000)
    throw Error('Multi-parcel shipment price exceeds limits.');
  return {provider:'easypost',mode:'test',method:'domestic_shipping',
    parcelCount:selected.length,shippingCents,selectedRates:selected,
    pickupAvailable:false,chargeable:false};
}
/**
 * These are planning estimates. Do not treat them as a Stripe line item:
 * rates can expire/change, provider mode is test, tax is unknown.
 */
export function composeCarrierPrecheckout(verifiedProductQuote,carrierQuote,destination){
  if(!carrierQuote||carrierQuote.provider!=='easypost'||carrierQuote.mode!=='test'||
    carrierQuote.chargeable!==false||!Number.isSafeInteger(carrierQuote.shippingCents)||
    carrierQuote.shippingCents<1||!Number.isSafeInteger(carrierQuote.parcelCount)||carrierQuote.parcelCount<1)
    throw Error('Verified test-mode carrier quote is required.');
  const address=validateUSShippingAddress(destination);
  const base=composePrecheckoutTotals(verifiedProductQuote,{
    method:'domestic_shipping',country:'US',pickupAvailable:false,
    region:shippingRegion(address.state),addressVerified:false,
    shippingCents:carrierQuote.shippingCents
  });
  // Prevent callers from confusing test prices with production chargeable rates.
  return {...base,rateProvider:'easypost',rateMode:'test',
    ratedParcelCount:carrierQuote.parcelCount,carrierRateConfirmedForPayment:false,
    checkoutReady:false};
}
