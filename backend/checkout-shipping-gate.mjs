import {verifyMeasuredParcel} from './shipping-dimensions-guard.mjs';
import {validateCarrierParcel} from './carrier-parcel-readiness.mjs';
export function checkoutShippingGate(input){
 const measured=verifyMeasuredParcel(input);
 if(!measured.verified)return {ready:false,reason:measured.reason};
 const carrier=validateCarrierParcel(input);
 return {ready:carrier.ready,reason:carrier.reason||null,carrier};
}
