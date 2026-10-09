import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,ScanCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {reply,jsonBody,identityOf,isAdmin} from './security.mjs';
import {
  catalogAdminReview,validateApprovalIntent,
  planApprovalMutation,samePriorApprovalAudit
} from './catalog-admin-logic.mjs';

const db=DynamoDBDocumentClient.from(new DynamoDBClient({}));
const PAGES=15;
async function scanComplete(table,projection,names){
  const items=[];let key,pages=0;
  do{
    const r=await db.send(new ScanCommand({TableName:table,ConsistentRead:true,Limit:100,
      ProjectionExpression:projection,ExpressionAttributeNames:names,ExclusiveStartKey:key}));
    items.push(...(r.Items||[]));key=r.LastEvaluatedKey;pages++;
    if(key&&pages>=PAGES)throw Error('CATALOG_REVIEW_SCAN_LIMIT');
  }while(key);
  return items;
}
async function get(table,key){
  return (await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
}
async function reviews(){
  const [products,approvals]=await Promise.all([
    scanComplete(process.env.HOBBYHUB_PRODUCTS_TABLE,
      '#id,#sku,#name,#status,#price,#category,#active,#oldActive,#image,#set,#collector,#condition,#finish,#lang',{
      '#id':'productId','#sku':'sku','#name':'productName','#status':'status',
      '#price':'salePrice','#category':'category','#active':'isactive',
      '#oldActive':'isActive','#image':'imageUrl','#set':'setCode',
      '#collector':'collectorNumber','#condition':'condition',
      '#finish':'finish','#lang':'language'
    }),
    scanComplete(process.env.HOBBYHUB_CATALOG_APPROVALS_TABLE,
      '#id,#revision,#approved,#fingerprint,#approvedAt',{
        '#id':'productId','#revision':'revision','#approved':'approved',
        '#fingerprint':'fingerprint','#approvedAt':'approvedAt'
      })
  ]);
  return catalogAdminReview(products,approvals);
}
export async function catalogApprovalAdminHandler(event){
  const actor=identityOf(event);
  if(!actor)return reply(401,{message:'Sign-in required.'});
  if(!isAdmin(event))return reply(403,{message:'Administrator approval is required.'});
  const productsTable=process.env.HOBBYHUB_PRODUCTS_TABLE;
  const approvalTable=process.env.HOBBYHUB_CATALOG_APPROVALS_TABLE;
  const auditTable=process.env.HOBBYHUB_STOCK_V2_AUDIT_TABLE;
  if(!productsTable||!approvalTable||!auditTable)
    return reply(503,{message:'Catalog approval service is not configured.'});
  const method=event.requestContext?.http?.method||event.httpMethod;
  try{
    if(method==='GET' && !event.pathParameters?.productId) {
      const items=await reviews();
      return reply(200,{mode:'admin-review-only',
        writesEnabled:process.env.HOBBYHUB_CATALOG_APPROVAL_WRITES_ENABLED==='true',
        items});
    }
    if(method!=='POST'||process.env.HOBBYHUB_CATALOG_APPROVAL_WRITES_ENABLED!=='true')
      return reply(503,{message:'Publication changes are disabled.'});
    const productId=decodeURIComponent(event.pathParameters?.productId||'');
    const action=event.rawPath?.endsWith('/approve')?'approve':
      event.rawPath?.endsWith('/revoke')?'revoke':null;
    if(!action)return reply(405,{message:'Unsupported catalog action.'});
    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(productId))
      return reply(400,{message:'Invalid immutable productId.'});
    const intent=validateApprovalIntent(jsonBody(event),action);
    const oldAudit=await get(auditTable,{requestId:intent.requestId});
    if(oldAudit){
      return samePriorApprovalAudit(oldAudit,productId,intent)?
        reply(200,{applied:true,idempotent:true,productId,revision:oldAudit.toRevision}):
        reply(409,{message:'Idempotency key was used for another catalog action.'});
    }
    const current=await get(productsTable,{productId});
    if(!current)return reply(404,{message:'Original product no longer exists.'});
    const prior=await get(approvalTable,{productId});
    // For approval, compare exact server-read product fingerprint to the
    // candidate shown in the protected review panel. No client-authored price.
    const planned=planApprovalMutation({
      intent,product:current,prior,actorId:actor,now:new Date().toISOString(),
      approvalTable,auditTable
    });
    try{
      await db.send(new TransactWriteCommand({TransactItems:planned.transactItems}));
    }catch(e){
      const replay=await get(auditTable,{requestId:intent.requestId});
      if(samePriorApprovalAudit(replay,productId,intent))
        return reply(200,{applied:true,idempotent:true,productId,revision:replay.toRevision});
      if(e?.name==='TransactionCanceledException'||e?.name==='ConditionalCheckFailedException')
        return reply(409,{message:'Publication approval changed; reload before retrying.'});
      throw e;
    }
    return reply(200,{applied:true,idempotent:false,
      productId,approved:planned.record.approved,revision:planned.record.revision});
  }catch(e){
    if(/Invalid|Exact |changed since review|revision|Unsupported|requires/.test(e?.message||''))
      return reply(400,{message:e.message});
    console.error('Catalog approval failed',e?.name||'Unknown');
    return reply(503,{message:'Catalog approval could not be verified; reload before retrying.'});
  }
}
