import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,ScanCommand} from '@aws-sdk/lib-dynamodb';
import {identityOf,isAdmin,reply} from './security.mjs';
import {legacyStockListFromDynamoRows} from './legacy-stock-read-logic.mjs';

const dynamo=DynamoDBDocumentClient.from(new DynamoDBClient({}));
/**
 * Read only: original inventory productId table.
 * Deliberately has no DynamoDB mutation IAM permission or POST API route.
 */
export async function legacyStockReadHandler(event){
  if(!identityOf(event))return reply(401,{message:'Sign in to view verified legacy inventory.'});
  if(!isAdmin(event))return reply(403,{message:'Admin privileges are required.'});
  if((event.requestContext?.http?.method||event.httpMethod)!=='GET')
    return reply(405,{message:'Legacy inventory is read-only through this service.'});
  const table=process.env.HOBBYHUB_LEGACY_INVENTORY_TABLE;
  if(!table)return reply(503,{message:'Original Inventory table is not configured.'});
  try{
    const rows=[];let lastKey,pages=0;
    do{
      const response=await dynamo.send(new ScanCommand({
        TableName:table,ConsistentRead:true,Limit:100,ExclusiveStartKey:lastKey,
        ProjectionExpression:'#id,#qty,#reorder,#updated',
        ExpressionAttributeNames:{
          '#id':'productId','#qty':'quantityOnHand',
          '#reorder':'reorderPoint','#updated':'updatedAt'
        }
      }));
      rows.push(...(response.Items||[]));
      lastKey=response.LastEvaluatedKey;
      pages++;
      if(pages>=20 && lastKey)throw Error('LEGACY_STOCK_SCAN_LIMIT');
    }while(lastKey);
    const items=legacyStockListFromDynamoRows(rows);
    return reply(200,{source:'original-inventory',mode:'read-only',items});
  }catch(e){
    // Keep AWS keys, customer data, request tokens and raw rows out of logs.
    console.error('Legacy inventory read error',e?.name||'Unknown');
    return reply(503,{message:'Original Inventory could not be verified. No quantities are available.'});
  }
}
