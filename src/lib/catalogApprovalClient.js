/** Optional admin-only Catalog V2 approval service. No direct AWS access. */
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
export function normalizeCatalogApprovalReview(data){
  if(data?.mode!=='admin-review-only'||!Array.isArray(data.items))
    throw Error('Catalog approval service response cannot be verified.');
  const ids=new Set();
  return {
    writesEnabled:data.writesEnabled===true,
    items:data.items.map(x=>{
      if(typeof x?.productId!=='string'||!ID.test(x.productId)||ids.has(x.productId))
        throw Error('Catalog approval list contains invalid product identities.');
      ids.add(x.productId);
      if(!Number.isSafeInteger(x.approvalRevision)||x.approvalRevision<0 ||
         typeof x.approved!=='boolean'||typeof x.canApprove!=='boolean')
        throw Error('Catalog approval list contains an invalid status.');
      const candidate=x.fingerprint===null?null:
        (typeof x.fingerprint==='string'&&HASH.test(x.fingerprint)?x.fingerprint:null);
      if(x.canApprove&&!candidate)throw Error('Catalog approvable item missing fingerprint.');
      return {
        productId:x.productId,sku:String(x.sku||''),
        productName:String(x.productName||''),
        status:String(x.status||'UNKNOWN'),
        salePrice:typeof x.salePrice==='number'&&Number.isFinite(x.salePrice)?x.salePrice:null,
        fingerprint:candidate,approved:x.approved,canApprove:x.canApprove,
        duplicateSku:x.duplicateSku===true,needsReview:x.needsReview===true,
        approvalRevision:x.approvalRevision,updatedAt:x.updatedAt||null
      };
    })
  };
}
export async function getCatalogApprovals(base,token,fetchImpl=fetch){
  if(!/^https:\/\//i.test(base||'')||!token)throw Error('Verified admin catalog API is not connected.');
  const res=await fetchImpl(base.replace(/\/$/,'')+'/ops/catalog-approvals',{
    method:'GET',headers:{Authorization:'Bearer '+token},cache:'no-store'
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.message||'Could not verify catalog approvals.');
  return normalizeCatalogApprovalReview(data);
}
export async function changeCatalogApproval(base,token,record,action,fetchImpl=fetch,uuid=globalThis.crypto?.randomUUID?.()){
  if(!/^https:\/\//i.test(base||'')||!token||
     !['approve','revoke'].includes(action)||!record||!ID.test(record.productId||'')||
     !Number.isSafeInteger(record.approvalRevision)||record.approvalRevision<0)
    throw Error('Catalog action requires verified admin review.');
  if(typeof uuid!=='string'||!/^[0-9a-f-]{36}$/i.test(uuid))
    throw Error('Unique request ID is required.');
  if(action==='approve'&&(!record.canApprove||!HASH.test(record.fingerprint||'')))
    throw Error('Product is not approved for catalog consideration.');
  const payload={requestId:uuid,expectedRevision:record.approvalRevision,
    ...(action==='approve'?{expectedFingerprint:record.fingerprint}:{})};
  const res=await fetchImpl(base.replace(/\/$/,'')+'/ops/catalog-approvals/'+
    encodeURIComponent(record.productId)+'/'+action,{
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      cache:'no-store',body:JSON.stringify(payload)
    });
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.message||'Catalog approval was not confirmed.');
  if(data.applied!==true||data.productId!==record.productId||
     data.revision!==record.approvalRevision+1)
    throw Error('Server did not confirm the exact approval version; refresh before retrying.');
  return data;
}
