import {publicationFingerprint,approvalForProduct,verifiedPublicationApprovals} from './publication-approvals.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;

export function catalogAdminReview(products,approvals){
  if(!Array.isArray(products)||products.length>1500)throw Error('Complete bounded product list required.');
  const stored=verifiedPublicationApprovals(approvals);
  const counts=new Map(),ids=new Set();
  for(const p of products){
    if(typeof p?.productId!=='string'||!ID.test(p.productId)||ids.has(p.productId))
      throw Error('Duplicate or invalid original Products identity.');
    ids.add(p.productId);
    const sku=String(p.sku||'').trim().toLowerCase();
    if(sku)counts.set(sku,(counts.get(sku)||0)+1);
  }
  for(const id of stored.keys())if(!ids.has(id))
    throw Error('Orphaned approval record cannot be ignored.');
  return products.map(p=>{
    const prior=stored.get(p.productId);
    const sku=String(p.sku||'').trim();
    const duplicate=!!sku && counts.get(sku.toLowerCase())!==1;
    let fingerprint=null;
    try{fingerprint=publicationFingerprint(p);}catch{}
    const approved=Boolean(!duplicate&&fingerprint&&approvalForProduct(p,prior));
    return {
      productId:p.productId,sku,productName:String(p.productName||'').trim(),
      salePrice:typeof p.salePrice==='number'?p.salePrice:null,
      status:String(p.status||'UNKNOWN'),
      fingerprint,
      duplicateSku:duplicate,
      approvalRevision:prior?.revision??0,
      approved,
      canApprove:Boolean(fingerprint&&!duplicate),
      needsReview:Boolean(prior?.approved===true&&!approved),
      updatedAt:typeof prior?.approvedAt==='string'?prior.approvedAt:null,
    };
  });
}
export function validateApprovalIntent(input,action){
  if(action!=='approve'&&action!=='revoke')throw Error('Unsupported publication action.');
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw Error('Publication action body is required.');
  const allowed=new Set(['requestId','expectedRevision',...(action==='approve'?['expectedFingerprint']:[])]);
  if(Object.keys(input).some(k=>!allowed.has(k)))
    throw Error('Publication action contains unsupported fields.');
  if(!UUID.test(input.requestId||''))throw Error('Valid request idempotency key required.');
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)
    throw Error('Exact approval revision is required.');
  if(action==='approve'&&!HASH.test(input.expectedFingerprint||''))
    throw Error('Exact product fingerprint is required.');
  return {action,requestId:input.requestId.toLowerCase(),
    expectedRevision:input.expectedRevision,
    ...(action==='approve'?{expectedFingerprint:input.expectedFingerprint}:{})};
}
/**
 * Generates conditional DynamoDB transactions but NEVER executes them.
 * Server must independently authenticate an admin and verify live Products.
 */
export function planApprovalMutation({intent,product,prior,actorId,now,approvalTable,auditTable}){
  if(!intent||!['approve','revoke'].includes(intent.action)||!ID.test(product?.productId||'')||
    typeof actorId!=='string'||!ID.test(actorId)||
    !approvalTable||!auditTable||approvalTable===auditTable||
    typeof now!=='string'||!Number.isFinite(Date.parse(now)))
    throw Error('Authorized publication context is not verified.');
  const oldRevision=prior?.revision??0;
  if(oldRevision!==intent.expectedRevision)
    throw Error('Publication approval changed. Reload exact product and approval.');
  if(oldRevision && (prior?.productId!==product.productId||!Number.isSafeInteger(oldRevision)))
    throw Error('Publication approval identity/version changed.');
  let fingerprint=null;
  if(intent.action==='approve'){
    fingerprint=publicationFingerprint(product);
    if(fingerprint!==intent.expectedFingerprint)
      throw Error('Product details changed since review; no approval saved.');
  }
  const revision=oldRevision+1;
  const updated={productId:product.productId,revision,
    approved:intent.action==='approve',
    approvedAt:now,approvedBy:actorId,
    ...(fingerprint?{fingerprint}:{})};
  const audit={requestId:intent.requestId,productId:product.productId,
    operation:intent.action==='approve'?'catalog-approve':'catalog-revoke',
    fromRevision:oldRevision,toRevision:revision,
    actor:actorId,createdAt:now,
    ...(fingerprint?{fingerprint}:{})};
  const put={
    TableName:approvalTable,Item:updated,
    ConditionExpression:oldRevision===0?
      'attribute_not_exists(productId)':'#rev = :expected',
    ...(oldRevision?{
      ExpressionAttributeNames:{'#rev':'revision'},
      ExpressionAttributeValues:{':expected':oldRevision}
    }:{})
  };
  return {record:updated,audit,transactItems:[
    {Put:put},
    {Put:{TableName:auditTable,Item:audit,
      ConditionExpression:'attribute_not_exists(requestId)'}}
  ]};
}
export function samePriorApprovalAudit(audit,productId,intent) {
  return Boolean(audit&&audit.requestId===intent?.requestId&&
    audit.productId===productId&&
    audit.operation===(intent.action==='approve'?'catalog-approve':'catalog-revoke')&&
    audit.fromRevision===intent.expectedRevision&&
    (intent.action!=='approve'||audit.fingerprint===intent.expectedFingerprint));
}
