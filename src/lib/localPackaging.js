import {measuredPackagingProfile} from './packagingWorksheet.js';

export const LOCAL_PACKAGE_KEY='hobbyhub-shipping-packages-v1';
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FIELDS=['lengthIn','widthIn','heightIn','weightOz'];
export function validateLocalPackageDraft(values) {
  if(!values || typeof values!=='object' || Array.isArray(values))
    throw Error('Enter all four measured package values.');
  const shippingPackage={};
  for(const field of FIELDS){
    const raw=values[field];
    if(typeof raw!=='string' && typeof raw!=='number')throw Error('Package '+field+' is missing.');
    const text=String(raw).trim();
    if(!/^(?:[1-9]\d{0,3}|0)(?:\.\d)?$/.test(text))throw Error('Packed '+field+' must be a positive number with at most one decimal place.');
    const number=Number(text);
    if(number<=0 || number>(field==='weightOz'?1120:48))
      throw Error('Packed '+field+' must be positive and within limits.');
    shippingPackage[field]=number;
  }
  const note=String(values.note||'').trim();
  if(note.length>180||/[\r\n\u0000-\u001f\u007f]/.test(note))throw Error('Package note is too long or contains unsupported characters.');
  return {shippingPackage,note,recordedAt:new Date().toISOString()};
}
export function readSavedPackages(serialized) {
  if(typeof serialized!=='string'||serialized.length>400000)return {};
  let parsed;
  try {parsed=JSON.parse(serialized);}catch{return {};}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||parsed.version!==1||
     !parsed.items||typeof parsed.items!=='object'||Array.isArray(parsed.items))return {};
  const rows={};
  for(const [id,draft] of Object.entries(parsed.items).slice(0,2500)){
    if(!ID.test(id)||id==='__proto__'||id==='constructor'||id==='prototype'||!draft||typeof draft!=='object')continue;
    const metrics=measuredPackagingProfile({shippingPackage:draft.shippingPackage});
    if(!metrics)continue;
    rows[id]={shippingPackage:{
      lengthIn:metrics.packedLengthIn,widthIn:metrics.packedWidthIn,
      heightIn:metrics.packedHeightIn,weightOz:metrics.packedWeightOz},
      note:typeof draft.note==='string'?draft.note.slice(0,180):'',
      recordedAt:typeof draft.recordedAt==='string'?draft.recordedAt:''
    };
  }
  return rows;
}
export function savePackageDrafts(drafts) {
  if(!drafts||typeof drafts!=='object'||Array.isArray(drafts)||
     Object.keys(drafts).length>2500)throw Error('Too many local package records.');
  for(const id of Object.keys(drafts)){
    if(!ID.test(id)||id==='__proto__'||id==='constructor'||id==='prototype')throw Error('Invalid product identity for packaging.');
    if(!measuredPackagingProfile(drafts[id]))throw Error('Invalid saved package measurements.');
  }
  const result=JSON.stringify({version:1,items:drafts});
  if(result.length>400000)throw Error('Local package storage limit exceeded. Export a CSV backup.');
  return result;
}
export function withLocalPackaging(products,drafts) {
  if(!Array.isArray(products)||!drafts||typeof drafts!=='object')throw Error('Product data is unavailable.');
  return products.map(p=>{
    // If already in AWS, keep it authoritative. Browser-only copies never
    // update AWS or become verified shipping-rate inputs.
    if(measuredPackagingProfile(p))return p;
    const draft=drafts[p.productId];
    return draft && measuredPackagingProfile(draft)
      ? {...p,shippingPackage:{...draft.shippingPackage},localPackageOnly:true}
      : p;
  });
}
