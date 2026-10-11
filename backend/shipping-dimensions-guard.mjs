export function verifyMeasuredParcel(parcel){
 if(!parcel||parcel.measurementSource!=='seller-measured')return {verified:false,reason:'PHYSICAL_MEASUREMENT_REQUIRED'};
 const keys=['weightOz','lengthIn','widthIn','heightIn'];
 if(keys.some(k=>typeof parcel[k]!=='number'||!Number.isFinite(parcel[k])||parcel[k]<=0))return {verified:false,reason:'INVALID_MEASUREMENTS'};
 return {verified:true,weightOz:parcel.weightOz,lengthIn:parcel.lengthIn,widthIn:parcel.widthIn,heightIn:parcel.heightIn};
}
