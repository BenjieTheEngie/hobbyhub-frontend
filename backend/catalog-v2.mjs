import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,ScanCommand} from '@aws-sdk/lib-dynamodb';
import {reply} from './security.mjs';
import {verifiedStockRows,joinedPublicCatalog} from './stock-v2-logic.mjs';

const db=DynamoDBDocumentClient.from(new DynamoDBClient({}));
async function scanBounded(table,projection,names) {
  const rows=[];let key,pages=0;
  do {
    const res=await db.send(new ScanCommand({TableName:table,ConsistentRead:true,Limit:100,
      ...(projection?{ProjectionExpression:projection,ExpressionAttributeNames:names}:{}),
      ExclusiveStartKey:key}));
    rows.push(...(res.Items||[])); key=res.LastEvaluatedKey;pages++;
  }while(key&&pages<15);
  if(key)throw Error('CATALOG_SCAN_LIMIT');
  return rows;
}
/**
 * Public catalog only: no admin JWT or private customer information.
 * Never derive a live listing from an unverified legacy stock quantity.
 * All publication must be explicit and duplicate SKU groups are excluded.
 */
export async function catalogV2Handler(event) {
  const method=event.requestContext?.http?.method||event.httpMethod;
  if(method!=='GET')return reply(405,{message:'GET required.'});
  const productsTable=process.env.HOBBYHUB_PRODUCTS_TABLE, stockTable=process.env.HOBBYHUB_STOCK_V2_TABLE;
  if(!productsTable||!stockTable)return reply(503,{message:'Public catalog is not configured.'});
  try{
    const [products,rawStocks]=await Promise.all([
      scanBounded(productsTable,'#id,#sku,#name,#category,#price,#published,#active,#oldActive,#image,#set,#collector,#condition,#finish,#lang',{
        '#id':'productId','#sku':'sku','#name':'productName','#category':'category','#price':'salePrice',
        '#published':'published','#active':'isactive','#oldActive':'isActive','#image':'imageUrl',
        '#set':'setCode','#collector':'collectorNumber','#condition':'condition','#finish':'finish','#lang':'language'
      }),
      scanBounded(stockTable,'#id,#qty,#reserved,#reorder,#version,#updated',{
        '#id':'productId','#qty':'onHand','#reserved':'reserved','#reorder':'reorderPoint','#version':'version','#updated':'updatedAt'
      })
    ]);
    const items=joinedPublicCatalog(products,verifiedStockRows(rawStocks));
    const origin=process.env.HOBBYHUB_ALLOWED_ORIGIN||'https://hobbyhub.company';
    return {statusCode:200,headers:{'Content-Type':'application/json',
      'Cache-Control':'public,max-age=30','Access-Control-Allow-Origin':origin,Vary:'Origin'},
      body:JSON.stringify({items})};
  }catch(e){
    console.error('Public catalog v2 failed',e?.name||'Unknown');
    return reply(503,{message:'Catalog temporarily unavailable.'});
  }
}
