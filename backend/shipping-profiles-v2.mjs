import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,ScanCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {identityOf,isAdmin,jsonBody,reply} from './security.mjs';
import {validateShippingProfileDraft,readShippingProfile,readShippingProfileList,draftProfileTransactionPlan} from './shipping-profiles-v2-logic.mjs';

const doc=DynamoDBDocumentClient.from(new DynamoDBClient({}));
const profileTable=()=>process.env.HOBBYHUB_SHIPPING_PROFILE_TABLE;
const auditTable=()=>process.env.HOBBYHUB_SHIPPING_PROFILE_AUDIT_TABLE;
const productTable=()=>process.env.HOBBYHUB_PRODUCTS_TABLE;
const writesEnabled=()=>process.env.HOBBYHUB_SHIPPING_PROFILE_WRITES_ENABLED==='true';
function errReply(e) {
  if(e?.name==='ConditionalCheckFailedException'||e?.name==='TransactionCanceledException')
    return reply(409,{message:'Shipping profile changed or the request was already used. Refresh first.'});
  if(/^Invalid |^Only |^A valid |^Packed |^Expected |^Draft /.test(e?.message||''))
    return reply(400,{message:e.message});
  console.error('Shipping draft profile operation failed',e?.name||'Unknown');
  return reply(503,{message:'Shipping draft profile could not be verified. No result confirmed.'});
}
async function scanProfiles(){
  const rows=[];let lastKey,pages=0;
  do{
    const r=await doc.send(new ScanCommand({
      TableName:profileTable(),ConsistentRead:true,Limit:100,ExclusiveStartKey:lastKey
    }));
    rows.push(...(r.Items||[]));lastKey=r.LastEvaluatedKey;pages++;
    if(lastKey&&pages>=15)throw Error('SHIPPING_PROFILE_SCAN_LIMIT');
  }while(lastKey);
  return readShippingProfileList(rows);
}
async function getProfile(id){
  const row=(await doc.send(new GetCommand({
    TableName:profileTable(),Key:{productId:id},ConsistentRead:true
  }))).Item;
  return row?readShippingProfile(row):null;
}
async function existingProduct(id) {
  const row=(await doc.send(new GetCommand({
    TableName:productTable(),Key:{productId:id},ConsistentRead:true,
    ProjectionExpression:'#id,#status',
    ExpressionAttributeNames:{'#id':'productId','#status':'status'}
  }))).Item;
  return Boolean(row?.productId===id && row.status==='ACTIVE');
}
async function getAudit(requestId) {
  return (await doc.send(new GetCommand({
    TableName:auditTable(),Key:{requestId},ConsistentRead:true
  }))).Item;
}
function matchesAudit(audit,plan,actorId) {
  if(!audit||audit.operation!=='set-package-draft'||audit.requestId!==plan.requestId||
    audit.productId!==plan.productId||audit.actorId!==actorId||
    audit.expectedVersion!==plan.expectedVersion||
    audit.note!==plan.transactItems[1].Put.Item.note)return false;
  return JSON.stringify(audit.shippingPackage)===
    JSON.stringify(plan.transactItems[1].Put.Item.shippingPackage);
}
/**
 * JWT-admin-only source-ready shipping profiles.
 * GET is permitted when deployed, but profile writes are OFF by default.
 * Neither route can modify Products, Inventory, Stock V2, orders or Stripe.
 */
export async function shippingProfilesV2Handler(event){
  if(!identityOf(event))return reply(401,{message:'Sign-in is required.'});
  if(!isAdmin(event))return reply(403,{message:'Admin privileges are required.'});
  if(!profileTable()||!auditTable()||!productTable())
    return reply(503,{message:'Shipping profiles service is not configured.'});
  const method=event.requestContext?.http?.method||event.httpMethod;
  const rawId=event.pathParameters?.productId;
  let productId;
  try{
    if(rawId) {
      productId=decodeURIComponent(rawId);
      if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(productId))
        return reply(400,{message:'Invalid productId.'});
    }
  }catch{return reply(400,{message:'Invalid encoded productId.'});}
  try{
    if(method==='GET'&&!productId)return reply(200,{
      source:'shipping-profiles-v2',mode:'draft-only',
      items:await scanProfiles()
    });
    if(method==='GET'&&productId){
      const row=await getProfile(productId);
      return row?reply(200,{source:'shipping-profiles-v2',mode:'draft-only',item:row}):
        reply(404,{message:'No shipping profile draft for this productId.'});
    }
    if(method!=='PUT'||!productId)return reply(405,{message:'Unsupported profile operation.'});
    if(!writesEnabled())return reply(503,{message:'Shipping profile draft writes are disabled.'});
    const payload=validateShippingProfileDraft(jsonBody(event));
    if(!await existingProduct(productId))
      return reply(404,{message:'Product not found or not ACTIVE in original Products table.'});
    const actorId=identityOf(event);
    const now=new Date().toISOString();
    const plan=draftProfileTransactionPlan(productId,payload,{
      profileTable:profileTable(),auditTable:auditTable(),actorId,now
    });
    let replay=await getAudit(payload.requestId);
    if(replay){
      if(!matchesAudit(replay,plan,actorId))
        return reply(409,{message:'Request ID belongs to another profile edit.'});
      return reply(200,{saved:true,idempotent:true,item:await getProfile(productId)});
    }
    try{
      await doc.send(new TransactWriteCommand({TransactItems:plan.transactItems}));
    }catch(e){
      replay=await getAudit(payload.requestId);
      if(replay&&matchesAudit(replay,plan,actorId))
        return reply(200,{saved:true,idempotent:true,item:await getProfile(productId)});
      throw e;
    }
    const after=await getProfile(productId);
    if(!after||after.version!==payload.expectedVersion+1)
      return reply(503,{message:'Update acknowledged but exact saved profile could not be verified; refresh before retrying.'});
    return reply(200,{saved:true,idempotent:false,item:after});
  }catch(e){return errReply(e);}
}
