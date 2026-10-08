import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient, ScanCommand} from '@aws-sdk/lib-dynamodb';
import {reply} from './security.mjs';

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const PUBLIC_KEYS = ['sku','productName','category','salePrice','quantityOnHand','imageUrl','setCode','collectorNumber','condition','finish','language'];
export function publicProduct(row) {
  if (row?.published !== true || row?.isactive === false || row?.isActive === false) return null;
  if (!row?.sku || !row?.productName) return null;
  const result = Object.fromEntries(PUBLIC_KEYS.filter(k=>row[k] !== undefined).map(k=>[k,row[k]]));
  result.salePrice = Number(result.salePrice ?? 0);
  result.quantityOnHand = Math.max(0, Number(result.quantityOnHand ?? 0));
  if (!Number.isFinite(result.salePrice) || result.salePrice < 0) return null;
  return result;
}
export async function catalogHandler(_event) {
  const table=process.env.HOBBYHUB_PRODUCTS_TABLE;
  if(!table)return reply(503,{message:'Catalog not configured.'});
  try {
    let lastKey, pages=0;const items=[];
    do {
      const data=await documentClient.send(new ScanCommand({TableName:table,Limit:200,ExclusiveStartKey:lastKey}));
      for(const r of data.Items||[]) {const item=publicProduct(r);if(item)items.push(item);}
      lastKey=data.LastEvaluatedKey;pages++;
    }while(lastKey && pages<8);
    if(lastKey)return reply(503,{message:'Catalog too large for temporary scan endpoint; a published-products index is required.'});
    return {statusCode:200,headers:{'Content-Type':'application/json','Cache-Control':'public,max-age=60','Access-Control-Allow-Origin':process.env.HOBBYHUB_ALLOWED_ORIGIN||'https://hobbyhub.company','Vary':'Origin'},body:JSON.stringify({items})};
  } catch(e) {console.error('Catalog read failed',e);return reply(502,{message:'Catalog temporarily unavailable.'});}
}
