import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,ScanCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {reply,jsonBody,identityOf,isAdmin} from './security.mjs';
import {validProductId,validateInitialization,validateAdjustment,stockBalance,ownRecord,MAX_UNITS} from './stock-v2-logic.mjs';

const doc=DynamoDBDocumentClient.from(new DynamoDBClient({}));
const stockTable=()=>process.env.HOBBYHUB_STOCK_V2_TABLE;
const auditTable=()=>process.env.HOBBYHUB_STOCK_V2_AUDIT_TABLE;
const writesEnabled=()=>process.env.HOBBYHUB_STOCK_V2_WRITES_ENABLED==='true';
const initEnabled=()=>process.env.HOBBYHUB_STOCK_V2_INIT_ENABLED==='true';
const maxPages=15;

async function priorAdjustment(requestId) {
  return (await doc.send(new GetCommand({TableName:auditTable(),Key:{requestId},ConsistentRead:true}))).Item;
}
async function currentStock(productId) {
  return (await doc.send(new GetCommand({TableName:stockTable(),Key:{productId},ConsistentRead:true}))).Item;
}
async function verifiedProductExists(productId) {
  // Legacy Products uses productId partition key; never assume SKU is unique.
  const row=(await doc.send(new GetCommand({TableName:process.env.HOBBYHUB_PRODUCTS_TABLE,
    Key:{productId},ConsistentRead:true,ProjectionExpression:'#pk',
    ExpressionAttributeNames:{'#pk':'productId'}}))).Item;
  return Boolean(row?.productId===productId);
}
async function allStock() {
  const rows=[];let key,pages=0;
  do {
    const r=await doc.send(new ScanCommand({TableName:stockTable(),ConsistentRead:true,Limit:100,
      ExclusiveStartKey:key,ProjectionExpression:'#id,#qty,#reserved,#reorder,#v,#updated',
      ExpressionAttributeNames:{'#id':'productId','#qty':'onHand','#reserved':'reserved','#reorder':'reorderPoint','#v':'version','#updated':'updatedAt'}}));
    rows.push(...(r.Items||[]));key=r.LastEvaluatedKey;pages++;
  }while(key && pages<maxPages);
  if(key)throw Error('STOCK_SCAN_LIMIT');
  return rows.map(stockBalance).filter(Boolean);
}
function errorReply(e) {
  if(e?.name==='TransactionCanceledException'||e?.name==='ConditionalCheckFailedException')return reply(409,{message:'Stock changed, was already initialized, or the request was previously used. Reload before retrying.'});
  if(e?.message==='STOCK_SCAN_LIMIT')return reply(503,{message:'Stock table needs paginated access before continuing.'});
  if(/^Invalid |^Stock |^Initial |^Reorder |^Expected |^Use the initialization|^Initialization /.test(e?.message||''))return reply(400,{message:e.message});
  console.error('Stock v2 operation failed',e?.name||'Unknown');return reply(503,{message:'Could not verify stock operation. Refresh stock before retrying.'});
}
async function handleInitialize(event,productId) {
  if(!writesEnabled()||!initEnabled())return reply(503,{message:'Stock initialization is disabled until verified inventory balances are ready.'});
  const input=validateInitialization(jsonBody(event));
  const earlier=await priorAdjustment(input.requestId);
  if(earlier) {
    if(!ownRecord(earlier,productId,input,'initialize'))return reply(409,{message:'Request ID was already used for a different stock operation.'});
    return reply(200,{applied:true,idempotent:true,adjustment:{requestId:input.requestId,afterOnHand:earlier.afterOnHand},item:stockBalance(await currentStock(productId))});
  }
  if(!await verifiedProductExists(productId))return reply(404,{message:'Product ID does not exist in the original Products table.'});
  const now=new Date().toISOString();
  const row={productId,onHand:input.onHand,reserved:0,reorderPoint:input.reorderPoint,version:1,updatedAt:now};
  const audit={requestId:input.requestId,productId,operation:'initialize',onHand:input.onHand,
    reorderPoint:input.reorderPoint,reason:input.reason,note:input.note,beforeOnHand:null,afterOnHand:input.onHand,
    actor:identityOf(event),createdAt:now};
  try {
    await doc.send(new TransactWriteCommand({TransactItems:[
      {Put:{TableName:stockTable(),Item:row,ConditionExpression:'attribute_not_exists(productId)'}},
      {Put:{TableName:auditTable(),Item:audit,ConditionExpression:'attribute_not_exists(requestId)'}}
    ]}));
  }catch(e){
    const existing=await priorAdjustment(input.requestId);
    if(existing && ownRecord(existing,productId,input,'initialize'))return reply(200,{applied:true,idempotent:true,adjustment:{requestId:input.requestId,afterOnHand:existing.afterOnHand},item:stockBalance(await currentStock(productId))});
    throw e;
  }
  return reply(201,{applied:true,idempotent:false,adjustment:{requestId:input.requestId,afterOnHand:input.onHand},item:stockBalance(row)});
}
async function handleAdjust(event,productId) {
  if(!writesEnabled())return reply(503,{message:'Stock writes are disabled.'});
  const input=validateAdjustment(jsonBody(event));
  const earlier=await priorAdjustment(input.requestId);
  if(earlier) {
    if(!ownRecord(earlier,productId,input,'adjust'))return reply(409,{message:'Request ID was previously used for another stock operation.'});
    return reply(200,{applied:true,idempotent:true,adjustment:{requestId:input.requestId,afterOnHand:earlier.afterOnHand},item:stockBalance(await currentStock(productId))});
  }
  const before=stockBalance(await currentStock(productId));
  if(!before)return reply(409,{message:'Stock balance is not initialized. Verify and initialize this product before adjusting.'});
  if(before.version!==input.expectedVersion)return reply(409,{message:'The stock count has changed. Reload and review the latest balance.'});
  const finalQty=before.quantityOnHand+input.delta;
  if(!Number.isSafeInteger(finalQty)||finalQty<before.reserved||finalQty>MAX_UNITS)return reply(422,{message:'Adjustment would reduce on-hand stock below reserved units or exceed allowed limits.'});
  const now=new Date().toISOString();
  const audit={requestId:input.requestId,productId,operation:'adjust',delta:input.delta,
    expectedVersion:input.expectedVersion,beforeOnHand:before.quantityOnHand,afterOnHand:finalQty,
    reason:input.reason,note:input.note,actor:identityOf(event),createdAt:now};
  try{
    await doc.send(new TransactWriteCommand({TransactItems:[
      {Update:{TableName:stockTable(),Key:{productId},
        UpdateExpression:'SET #qty = #qty + :delta, #version = #version + :one, #updated = :now',
        ConditionExpression:'attribute_exists(productId) AND attribute_exists(#reserved) AND #version = :expected AND #qty >= :minimum AND #qty <= :maximum AND #qty + :delta >= #reserved',
        ExpressionAttributeNames:{'#qty':'onHand','#reserved':'reserved','#version':'version','#updated':'updatedAt'},
        ExpressionAttributeValues:{':delta':input.delta,':one':1,':now':now,':expected':input.expectedVersion,
          ':minimum':Math.max(0,-input.delta),':maximum':MAX_UNITS-Math.max(0,input.delta)}}},
      {Put:{TableName:auditTable(),Item:audit,ConditionExpression:'attribute_not_exists(requestId)'}}
    ]}));
  }catch(e){
    const existing=await priorAdjustment(input.requestId);
    if(existing && ownRecord(existing,productId,input,'adjust'))return reply(200,{applied:true,idempotent:true,adjustment:{requestId:input.requestId,afterOnHand:existing.afterOnHand},item:stockBalance(await currentStock(productId))});
    throw e;
  }
  return reply(200,{applied:true,idempotent:false,adjustment:{requestId:input.requestId,afterOnHand:finalQty},item:stockBalance(await currentStock(productId))});
}
export async function stockV2Handler(event) {
  if(!identityOf(event))return reply(401,{message:'Admin sign-in is required.'});
  if(!isAdmin(event))return reply(403,{message:'Admin privileges are required.'});
  if(!stockTable()||!auditTable()||!process.env.HOBBYHUB_PRODUCTS_TABLE)return reply(503,{message:'Stock service is not configured.'});
  const method=event.requestContext?.http?.method||event.httpMethod;
  let id;
  try {if(event.pathParameters?.productId)id=validProductId(decodeURIComponent(event.pathParameters.productId));}catch(e){return errorReply(e);}
  try{
    if(method==='GET'&&!id)return reply(200,{items:await allStock()});
    if(method==='GET'&&id){const item=stockBalance(await currentStock(id));return item?reply(200,{item}):reply(404,{message:'Stock is not initialized for this record.'});}
    if(method==='POST'&&id&&event.rawPath?.endsWith('/initialize'))return await handleInitialize(event,id);
    if(method==='POST'&&id&&event.rawPath?.endsWith('/adjust'))return await handleAdjust(event,id);
    return reply(405,{message:'This stock operation is not supported.'});
  }catch(e){return errorReply(e);}
}
