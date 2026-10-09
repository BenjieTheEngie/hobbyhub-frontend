import {createHash} from 'node:crypto';

/**
 * Publication approvals are SEPARATE from the original Products table.
 * No product is listed just because its legacy status is ACTIVE.
 *
 * This is an offline read model; it neither approves listings nor writes AWS.
 * An approval is valid only for a fixed snapshot of public product metadata.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SKU=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
const FINGERPRINT=/^[0-9a-f]{64}$/;
const fields=['category','setCode','collectorNumber','condition','finish','language','imageUrl'];

export function publicationFingerprint(product) {
  if(!product||typeof product.productId!=='string'||!ID.test(product.productId))
    throw Error('Publication requires a verified immutable productId.');
  const sku=typeof product.sku==='string'?product.sku.trim():'';
  const productName=typeof product.productName==='string'?product.productName.trim():'';
  if(!SKU.test(sku)||!productName||productName.length>200)
    throw Error('Publication requires a valid SKU and product name.');
  if(product.status!=='ACTIVE'||product.isactive===false||product.isActive===false)
    throw Error('Publication requires a confirmed active original product.');
  const price=product.salePrice;
  if(typeof price!=='number'||!Number.isFinite(price)||price<=0||price>50000||
     Math.abs(price*100-Math.round(price*100))>1e-6)
    throw Error('Publication requires a verified positive price in exact cents.');
  const publicFields={productId:product.productId,sku,productName,salePriceCents:Math.round(price*100),
    status:product.status};
  for(const field of fields) {
    const value=product[field];
    if(value!=null && typeof value!=='string')
      throw Error('Product publication metadata contains unsupported values.');
    const cleaned=String(value||'').trim();
    if(cleaned.length>500)throw Error('Product publication metadata is too long.');
    if(field==='imageUrl'&&cleaned&&!/^https:\/\//i.test(cleaned))
      throw Error('Publication images require HTTPS.');
    publicFields[field]=cleaned;
  }
  return createHash('sha256').update(JSON.stringify(publicFields)).digest('hex');
}
export function approvalForProduct(product,record) {
  if(!record||record.productId!==product?.productId||
     record.approved!==true||!FINGERPRINT.test(record.fingerprint||'')||
     !Number.isSafeInteger(record.revision)||record.revision<1||
     typeof record.approvedAt!=='string'||!Number.isFinite(Date.parse(record.approvedAt)))
    return false;
  try{return publicationFingerprint(product)===record.fingerprint;}
  catch{return false;}
}
export function verifiedPublicationApprovals(records) {
  if(!Array.isArray(records))throw Error('Complete publication approval snapshot is required.');
  const found=new Map();
  for(const row of records){
    if(!row||typeof row.productId!=='string'||!ID.test(row.productId)||found.has(row.productId))
      throw Error('Publication approval snapshot contains invalid or duplicate productId.');
    if(row.approved!==true&&row.approved!==false)
      throw Error('Publication state must be explicitly approved or declined.');
    if(!Number.isSafeInteger(row.revision)||row.revision<1)
      throw Error('Publication approval revision is invalid.');
    if(row.approved===true &&
       (!FINGERPRINT.test(row.fingerprint||'')||!Number.isFinite(Date.parse(row.approvedAt))))
      throw Error('Publication approval record is invalid.');
    found.set(row.productId,row);
  }
  return found;
}
/**
 * Join approvals across ALL source product rows, not only published ones:
 * joinedPublicCatalog must still count duplicate SKU groups globally.
 */
export function applyPublicationApprovals(products,approvalRows){
  if(!Array.isArray(products))throw Error('Complete product snapshot required.');
  const approvals=verifiedPublicationApprovals(approvalRows);
  const seen=new Set();
  const result=products.map(product=>{
    if(!product||typeof product.productId!=='string'||!ID.test(product.productId)||
       seen.has(product.productId))throw Error('Product publication snapshot has duplicate or invalid identity.');
    seen.add(product.productId);
    return {...product,published:approvalForProduct(product,approvals.get(product.productId))};
  });
  // An approval for a removed product is suspicious and must be investigated;
  // fail closed instead of proceeding with a potentially partial scan.
  for(const key of approvals.keys())if(!seen.has(key))
    throw Error('Publication approval is orphaned from Products.');
  return result;
}
export function publicationReadiness(products,approvalRows){
  const mapped=applyPublicationApprovals(products,approvalRows);
  const approved=mapped.filter(p=>p.published===true).length;
  return {total:mapped.length,approved,unapproved:mapped.length-approved,
    paymentsEnabled:false,publishingIsManual:true};
}
