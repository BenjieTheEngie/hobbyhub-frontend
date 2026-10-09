import {legacyStockListFromDynamoRows} from '../../backend/legacy-stock-read-logic.mjs';

/** Optional admin-only original Inventory GET service. No mutation API. */
export async function fetchLegacyStockReadOnly(base,token,fetchImpl=fetch){
  if(typeof base!=='string'||!/^https:\/\//i.test(base) || !token)
    throw Error('Verified admin inventory read service is not connected.');
  const res=await fetchImpl(base.replace(/\/$/,'')+'/ops/legacy-stock',{
    method:'GET',cache:'no-store',headers:{Authorization:'Bearer '+token}
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.message||'Original Inventory API cannot verify stock.');
  if(data.source!=='original-inventory'||data.mode!=='read-only')
    throw Error('Source identity is not original read-only Inventory.');
  return legacyStockListFromDynamoRows(data.items);
}
