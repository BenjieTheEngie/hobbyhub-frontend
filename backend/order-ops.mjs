import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,ScanCommand} from '@aws-sdk/lib-dynamodb';
import {reply,identityOf,isAdmin} from './security.mjs';

const db=DynamoDBDocumentClient.from(new DynamoDBClient({}));
/**
 * Administrative list view of a separate, future customer-order table.
 * Deliberately read-only. Nothing here creates charges, payment states,
 * stock reservations, refunds or shipments. It never returns PII.
 */
export async function orderOpsHandler(event) {
  if(!identityOf(event))return reply(401,{message:'Sign in to view customer orders.'});
  if(!isAdmin(event))return reply(403,{message:'Admin role is required.'});
  if((event.requestContext?.http?.method||event.httpMethod)!=='GET')return reply(405,{message:'Order operations are read-only.'});
  if(!process.env.HOBBYHUB_ORDER_V2_TABLE)return reply(503,{message:'Customer order service is not configured.'});
  const items=[];
  try{
    let key,pages=0;
    do{
      const result=await db.send(new ScanCommand({
        TableName:process.env.HOBBYHUB_ORDER_V2_TABLE,ConsistentRead:true,
        Limit:100,ExclusiveStartKey:key,
        ProjectionExpression:'#orderId,#paymentStatus,#fulfillmentStatus,#totalCents,#currency,#items,#createdAt,#updatedAt',
        ExpressionAttributeNames:{
          '#orderId':'orderId','#paymentStatus':'paymentStatus','#fulfillmentStatus':'fulfillmentStatus',
          '#totalCents':'totalCents','#currency':'currency','#items':'items',
          '#createdAt':'createdAt','#updatedAt':'updatedAt'
        }
      }));
      items.push(...(result.Items||[]));
      key=result.LastEvaluatedKey;pages++;
    }while(key && pages<15);
    if(key)return reply(503,{message:'Order volume requires paginated query support before reading can continue.'});
    return reply(200,{items});
  }catch(e){
    console.error('Customer order read failed',e?.name||'Unknown');
    return reply(503,{message:'Could not verify current customer orders.'});
  }
}
