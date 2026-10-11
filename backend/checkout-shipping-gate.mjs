import {validateCarrierParcel} from './carrier-parcel-readiness.mjs';
export function checkoutShippingGate(input){
 if(input?.measurementSource!=='seller-measured')return {ready:false,reason:'PHYSICAL_MEASUREMENT_REQUIRED'};
 const carrier=validateCarrierParcel(input);
 return {ready:carrier.ready,reason:carrier.reason||null,carrier};
}
