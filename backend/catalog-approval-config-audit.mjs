export function catalogApprovalConfigAudit(env){
 const keys=['HOBBYHUB_PRODUCTS_TABLE','HOBBYHUB_CATALOG_APPROVALS_TABLE'];
 const missing=keys.filter(k=>typeof env?.[k]!=='string'||!env[k].trim());
 return {ready:missing.length===0,missing,writesEnabled:missing.length===0&&env?.HOBBYHUB_CATALOG_APPROVAL_WRITES_ENABLED==='true'};
}
