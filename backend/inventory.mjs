import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,PutCommand,GetCommand,UpdateCommand,ScanCommand} from '@aws-sdk/lib-dynamodb';
import {identityOf,isAdmin,jsonBody,reply} from './security.mjs';
import {assessSkuMatch,tableKeyName,updateCondition} from './product-key.mjs';
import {inventoryWritesEnabled} from './guard.mjs';
const doc=DynamoDBDocumentClient.from(new DynamoDBClient({}));
const SKU=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
const FIELDS=['productName','sku','category','salePrice','quantityOnHand','reorderPoint','imageUrl','setCode','collectorNumber','condition','finish','language','barcode','published','isactive'];
function validation(raw) {
  const result=Object.fromEntries(FIELDS.filter(k=>raw[k]!==undefined).map(k=>[k,raw[k]]));
  if(typeof result.productName!=='string'||!result.productName.trim()||result.productName.length>200)throw Error('Product name must be 1–200 characters.');
  if(typeof result.sku!=='string'||!SKU.test(result.sku))throw Error('SKU must be 2–80 valid characters.');
  if(typeof result.category!=='string'||!result.category.trim()||result.category.length>80)throw Error('Category is required.');
  for(const name of ['quantityOnHand','reorderPoint']){result[name]=Number(result[name]??0);if(!Number.isSafeInteger(result[name])||result[name]<0)throw Error(`${name} must be a nonnegative integer.`);}
  result.salePrice=Number(result.salePrice);if(!Number.isFinite(result.salePrice)||result.salePrice<0)throw Error('Sale price must be nonnegative.');
  if(result.imageUrl && (typeof result.imageUrl!=='string'||!result.imageUrl.startsWith('https://')))throw Error('Image URL must use HTTPS.');
  result.productName=result.productName.trim();result.category=result.category.trim();
  // Product is not publicly visible until an administrator explicitly publishes it.
  result.published=result.published===true;result.isactive=result.isactive!==false;
  return result;
}
async function lookupProductKey(table, sku, keyName) {
  if (keyName === 'sku') return {status:'found',key:{sku}};
  // DynamoDB cannot GetItem by SKU when its partition key is productId.
  // An exact, strongly consistent and paginated scan is acceptable for this
  // small legacy table; a dedicated SKU index should replace it at scale.
  const matches=[];
  let lastKey, page=0;
  do {
    const result=await doc.send(new ScanCommand({
      TableName:table,ConsistentRead:true,Limit:100,ExclusiveStartKey:lastKey,
      FilterExpression:'#sku = :targetSku',
      ProjectionExpression:'#id, #sku',
      ExpressionAttributeNames:{'#id':'productId','#sku':'sku'},
      ExpressionAttributeValues:{':targetSku':sku},
    }));
    matches.push(...(result.Items||[]));
    if(matches.length>1)return {status:'ambiguous'};
    lastKey=result.LastEvaluatedKey;
    page++;
  } while(lastKey && page<20);
  if(lastKey)return {status:'limit'};
  return assessSkuMatch(matches,sku,keyName);
}
function lookupFailure(result,sku) {
  if(result.status==='ambiguous')return reply(409,{message:'More than one product uses SKU '+sku+'. No inventory changes made; manually resolve duplicate SKUs first.'});
  if(result.status==='limit')return reply(503,{message:'Too many products to safely find a unique SKU. Add an indexed SKU lookup first.'});
  return reply(404,{message:'No product was found with SKU '+sku+'.'});
}

export async function inventoryHandler(event){
  if(!identityOf(event))return reply(401,{message:'Authentication required.'});
  if(!isAdmin(event))return reply(403,{message:'Admin group membership required.'});
  const table=process.env.HOBBYHUB_PRODUCTS_TABLE;
  const keyName=tableKeyName();
  if(!table || !keyName)return reply(503,{message:'Product table and key schema must be configured before this API can be used.'});
  const method=event.requestContext?.http?.method||event.httpMethod;
  if(method!=='GET' && !inventoryWritesEnabled())return reply(503,{message:'Inventory writes are disabled. Legacy productId tables require explicit schema verification and write approval.'});
  const sku=event.pathParameters?.sku ? decodeURIComponent(event.pathParameters.sku) : '';
  if(sku&&!SKU.test(sku))return reply(400,{message:'Invalid product SKU.'});
  try{
    if(method==='GET') {
      const items=[];let last, pages=0;
      do{const result=await doc.send(new ScanCommand({TableName:table,Limit:200,ExclusiveStartKey:last}));items.push(...(result.Items||[]));last=result.LastEvaluatedKey;pages++;}while(last && pages<8);
      if(last)return reply(503,{message:'Inventory exceeds the temporary scanning limit. Add an index and paginated API before proceeding.'});
      return reply(200,{items});
    }
    if(method==='POST') {
      // A legacy productId table needs its original ID generator AND a unique-SKU
      // reservation strategy. A scan-then-Put would allow duplicate SKUs.
      if(keyName==='productId')return reply(501,{message:'Creating a new SKU requires adapting the existing productId generator and unique-SKU constraint. No item was created.'});
      const item=validation(jsonBody(event));
      await doc.send(new PutCommand({TableName:table,Item:item,ConditionExpression:'attribute_not_exists(sku)'}));
      return reply(201,{item});
    }
    if(method==='PUT') {
      if(!sku)return reply(400,{message:'SKU required.'});
      const item=validation(jsonBody(event));
      if(item.sku!==sku)return reply(400,{message:'Changing SKU is not supported.'});
      const match=await lookupProductKey(table,sku,keyName);
      if(match.status!=='found')return lookupFailure(match,sku);
      const existing=await doc.send(new GetCommand({TableName:table,Key:match.key,ConsistentRead:true}));
      if(!existing.Item || existing.Item.sku!==sku)return reply(409,{message:'Product identity changed or no longer exists. No changes were made.'});
      // Only mutate approved fields, preserving productId, supplier links,
      // procurement history and any other legacy DynamoDB attributes.
      const guards=updateCondition(keyName,existing.Item);
      const names={...guards.names}, values={...guards.values}, sets=[];
      let i=0;
      for(const [field,value] of Object.entries(item)) {
        if(field==='sku'||field===keyName)continue;
        const n='#field'+i, v=':field'+i;
        names[n]=field;values[v]=value;sets.push(n+' = '+v);i++;
      }
      // Keep the older isActive spelling consistent for legacy records.
      if(Object.prototype.hasOwnProperty.call(existing.Item,'isActive')) {
        names['#oldActive']='isActive';values[':oldActive']=item.isactive;
        sets.push('#oldActive = :oldActive');
      }
      const updated=await doc.send(new UpdateCommand({
        TableName:table,Key:match.key,UpdateExpression:'SET '+sets.join(', '),
        ConditionExpression:guards.condition,
        ExpressionAttributeNames:names,ExpressionAttributeValues:values,
        ReturnValues:'ALL_NEW',
      }));
      if(updated.Attributes?.sku!==sku)return reply(502,{message:'Updated item could not be verified. Refresh inventory before continuing.'});
      return reply(200,{item:updated.Attributes});
    }
    if(method==='DELETE') {
      if(!sku)return reply(400,{message:'SKU required.'});
      const match=await lookupProductKey(table,sku,keyName);
      if(match.status!=='found')return lookupFailure(match,sku);
      const existing=await doc.send(new GetCommand({TableName:table,Key:match.key,ConsistentRead:true}));
      if(!existing.Item || existing.Item.sku!==sku)return reply(409,{message:'Product identity changed. No SKU was archived.'});
      const guards=updateCondition(keyName,existing.Item);
      const names={...guards.names,'#active':'isactive','#published':'published'};
      const values={...guards.values,':inactive':false,':private':false};
      let expression='SET #active = :inactive, #published = :private';
      if(Object.prototype.hasOwnProperty.call(existing.Item,'isActive')) {
        names['#oldActive']='isActive';expression+=', #oldActive = :inactive';
      }
      // Keep the original productId and historical relationships. Use an
      // optimistic condition so an intervening stock change aborts the archive.
      const result=await doc.send(new UpdateCommand({
        TableName:table,Key:match.key,UpdateExpression:expression,
        ConditionExpression:guards.condition,
        ExpressionAttributeNames:names,ExpressionAttributeValues:values,
        ReturnValues:'ALL_NEW',
      }));
      if(result.Attributes?.sku!==sku ||
        result.Attributes?.isactive!==false ||
        result.Attributes?.published!==false) {
        return reply(502,{message:'Archiving could not be verified. Refresh inventory.'});
      }
      return reply(200,{archived:sku,isactive:false,published:false});
    }
    return reply(405,{message:'Method not supported.'});
  }catch(e){
    if(e?.name==='ConditionalCheckFailedException')return reply(409,{message:'This SKU was changed concurrently or no longer exists. Refresh inventory and retry. No archive was confirmed.'});
    if(e?.message && /^(Invalid|Product|Category|SKU|Changing|Sale price|quantityOnHand|reorderPoint|Image URL)/.test(e.message))return reply(400,{message:e.message});
    console.error('Inventory write failed',e);return reply(502,{message:'Inventory write failed. No success has been confirmed.'});
  }
}
