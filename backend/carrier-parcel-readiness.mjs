/** Offline-only parcel readiness for future US-only carrier-calculated checkout.
 * Never substitutes a fabricated rate for a carrier response.
 */
export function validateCarrierParcel(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw Error('Shipping parcel is required.');
  if(input.country!=='US')throw Error('Shipping is restricted to the United States.');
  if(input.fulfillment!=='shipping')throw Error('Only shipped orders are supported.');
  const {weightOz,lengthIn,widthIn,heightIn}=input;
  for(const [name,value] of Object.entries({weightOz,lengthIn,widthIn,heightIn}))
    if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1000)
      throw Error('Valid positive parcel '+name+' is required.');
  if(typeof input.postalCode!=='string'||!/^[0-9]{5}(?:-[0-9]{4})?$/.test(input.postalCode))
    throw Error('Valid US destination ZIP code is required.');
  if(typeof input.carrierQuoteId!=='string'||!input.carrierQuoteId.trim())
    return {ready:false,reason:'CARRIER_QUOTE_REQUIRED',country:'US',fulfillment:'shipping'};
  return {ready:true,country:'US',fulfillment:'shipping',
    parcel:{weightOz,lengthIn,widthIn,heightIn},postalCode:input.postalCode,
    carrierQuoteId:input.carrierQuoteId};
}
