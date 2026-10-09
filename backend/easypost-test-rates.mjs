import {prepareCarrierQuoteRequest,verifiedEasyPostRateOptions} from './carrier-rating-v2.mjs';

// Server-only, test-mode EasyPost rate inquiry. Creating a Shipment retrieves
// rates but DOES NOT buy a label. No POST /buy or production key is supported.
// Reference: https://docs.easypost.com/docs/shipments
export const EASYPOST_SHIPMENT_URL='https://api.easypost.com/v2/shipments';

export function requireTestEasyPostKey(apiKey){
  if(typeof apiKey!=='string'||!/^EZTK[A-Za-z0-9]{40,80}$/.test(apiKey))
    throw Error('Only an EasyPost TEST API key is permitted for the rate preview.');
  return apiKey;
}
function providerAddress(address){
  return {
    name:address.recipient,street1:address.line1,
    ...(address.line2?{street2:address.line2}:{}),
    city:address.city,state:address.state,zip:address.postalCode,country:'US'
  };
}
export function buildEasyPostShipmentBody({origin,destination,parcel}) {
  const q=prepareCarrierQuoteRequest({origin,destination,parcel});
  return {shipment:{
    to_address:providerAddress(q.toAddress),from_address:providerAddress(q.fromAddress),
    parcel:{
      length:q.parcel.lengthIn,width:q.parcel.widthIn,
      height:q.parcel.heightIn,weight:q.parcel.weightOz
    }
  }};
}
export async function requestEasyPostTestRates({apiKey,origin,destination,parcel,fetchImpl=fetch}) {
  requireTestEasyPostKey(apiKey);
  if(typeof fetchImpl!=='function')throw Error('Test carrier transport is not configured.');
  const body=buildEasyPostShipmentBody({origin,destination,parcel});
  let response;
  try{
    response=await fetchImpl(EASYPOST_SHIPMENT_URL,{
      method:'POST',
      headers:{
        Authorization:'Basic '+Buffer.from(apiKey+':').toString('base64'),
        'Content-Type':'application/json',
        Accept:'application/json'
      },
      body:JSON.stringify(body),
      signal:AbortSignal.timeout(9000)
    });
  }catch{
    throw Error('Carrier rate provider is unavailable; no shipping rate was confirmed.');
  }
  if(!response?.ok)throw Error('Carrier rate provider declined this inquiry; no rate was confirmed.');
  let data;
  try{data=await response.json();}catch{
    throw Error('Carrier response was not valid JSON; no rate was confirmed.');
  }
  const options=verifiedEasyPostRateOptions(data);
  if(!options.length)throw Error('No verified domestic carrier rates are available for this package.');
  return {provider:'easypost',mode:'test',shipmentId:typeof data.id==='string' && /^shp_[A-Za-z0-9]{8,80}$/.test(data.id)?data.id:null,options,
    rateOnly:true,labelPurchased:false};
}
