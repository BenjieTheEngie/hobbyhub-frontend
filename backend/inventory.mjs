import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,PutCommand,GetCommand,UpdateCommand,ScanCommand} from '@aws-sdk/lib-dynamodb';
import {identityOf,isAdmin,jsonBody,reply} from './security.mjs';
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
export async function inventoryHandler(event){
  if(!identityOf(event))return reply(401,{message:'Authentication required.'});
  if(!isAdmin(event))return reply(403,{message:'Admin group membership required.'});
  const table=process.env.HOBBYHUB_PRODUCTS_TABLE;
  if(!table || process.env.HOBBYHUB_PRODUCTS_PK_NAME!=='sku')return reply(503,{message:'Product table key schema must be reviewed and approved before this API is enabled.'});
  const method=event.requestContext?.http?.method||event.httpMethod;
  if(method!=='GET' && !inventoryWritesEnabled())return reply(503,{message:'Inventory writes are disabled until the actual DynamoDB key schema and staging behavior have been approved.'});
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
      const item=validation(jsonBody(event));
      await doc.send(new PutCommand({TableName:table,Item:item,ConditionExpression:'attribute_not_exists(sku)'}));
      return reply(201,{item});
    }
    if(method==='PUT'){
      if(!sku)return reply(400,{message:'SKU required.'});
      const item=validation(jsonBody(event));if(item.sku!==sku)return reply(400,{message:'Changing SKU is not supported.'});
      const data=await doc.send(new GetCommand({TableName:table,Key:{sku},ConsistentRead:true}));
      if(!data.Item)return reply(404,{message:'Product not found.'});
      // Update allowlisted fields only; never replace procurement metadata in the existing row.
      // The stock comparison detects concurrent checkout/reservation/stock modifications.
      const names={'#stock':'quantityOnHand'}, values={':expectedStock':Number(data.Item.quantityOnHand ?? 0)};
      const sets=[];
      let i=0;
      for(const [field,value] of Object.entries(item)) {
        if(field==='sku')continue;
        const key='#f'+i, val=':v'+i;
        names[key]=field;values[val]=value;sets.push(key+' = '+val);i++;
      }
      await doc.send(new UpdateCommand({TableName:table,Key:{sku},UpdateExpression:'SET '+sets.join(', '),ConditionExpression:'attribute_exists(sku) AND #stock = :expectedStock',ExpressionAttributeNames:names,ExpressionAttributeValues:values}));
      return reply(200,{item});
    }
    if(method==='DELETE'){
      if(!sku)return reply(400,{message:'SKU required.'});
      // Soft archive: preserve supplier records, purchase orders, and order history.
      await doc.send(new UpdateCommand({TableName:table,Key:{sku},UpdateExpression:'SET isactive = :inactive, published = :private',ConditionExpression:'attribute_exists(sku)',ExpressionAttributeValues:{':inactive':false,':private':false}}));
      return reply(200,{archived:sku});
    }
    return reply(405,{message:'Method not supported.'});
  }catch(e){
    if(e?.name==='ConditionalCheckFailedException')return reply(409,{message:'Product already exists or was removed. Refresh and retry.'});
    if(e?.message && /^(Invalid|Product|Category|SKU|Changing|Sale price|quantityOnHand|reorderPoint|Image URL)/.test(e.message))return reply(400,{message:e.message});
    console.error('Inventory write failed',e);return reply(502,{message:'Inventory write failed. No success has been confirmed.'});
  }
}
