export function stockV2ConfigAudit(env){
 const required=['HOBBYHUB_STOCK_V2_TABLE','HOBBYHUB_STOCK_V2_AUDIT_TABLE','HOBBYHUB_PRODUCTS_TABLE'];
 const missing=required.filter(k=>typeof env?.[k]!=='string'||!env[k].trim());
 const writes=env?.HOBBYHUB_STOCK_V2_WRITES_ENABLED==='true';
 const initialize=env?.HOBBYHUB_STOCK_V2_INIT_ENABLED==='true';
 return {ready:missing.length===0,missing,writesEnabled:writes&&missing.length===0,initializationEnabled:initialize&&writes&&missing.length===0};
}
