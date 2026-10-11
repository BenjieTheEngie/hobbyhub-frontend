export function approvalRevisionGuard(record,expectedRevision){
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('Valid expected approval revision required.');
 if(record==null)return {allowed:expectedRevision===0,nextRevision:1};
 if(!Number.isSafeInteger(record.revision)||record.revision<1)return {allowed:false,reason:'INVALID_RECORD'};
 return {allowed:record.revision===expectedRevision,nextRevision:record.revision+1,reason:record.revision===expectedRevision?null:'STALE_REVISION'};
}
