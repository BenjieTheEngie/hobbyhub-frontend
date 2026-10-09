#!/usr/bin/env node
/**
 * READ ONLY AWS CloudShell command:
 *   node scripts/stock-cutover-preflight.mjs
 *
 * Uses aws CLI read operations exclusively. Does not print product IDs,
 * per-item values, credentials, account ARN or customer fields.
 * Explicit pagination: incomplete scans abort rather than infer quantities.
 */
import {execFileSync} from 'node:child_process';
import {makeStockCutoverReview,safeCutoverSummary,assertStockCutoverStillCurrent} from '../backend/stock-cutover-review.mjs';

const REGION='us-east-2';
const ACCOUNT='349744180170';
const PRODUCT_TABLE='hobbyhub-ProductsTable-KC31XDEOENBG';
const INVENTORY_TABLE='hobbyhub-InventoryTable-X2IRQDAGW7WB';
const scriptArgs=process.argv.slice(2);
if(scriptArgs.length)throw Error('This audit takes no command-line arguments; it never enables writes.');
function aws(service,operation,args=[]) {
  const text=execFileSync('aws',[service,operation,'--region',REGION,'--output','json',...args],{
    encoding:'utf8',maxBuffer:8*1024*1024,timeout:35000,stdio:['ignore','pipe','pipe']
  });
  return JSON.parse(text);
}
function s(item,key){
  const value=item?.[key];
  return value?.S===undefined ? undefined : value.S;
}
function number(item,key){
  const raw=item?.[key]?.N;
  return raw===undefined ? undefined : Number(raw);
}
function scanFully(table,kind) {
  let token,tries=0;
  const all=[];
  const seenTokens=new Set();
  do{
    if(++tries>1000)throw Error(kind+' scan exceeded pagination limit. Source NOT verified.');
    const args=['--table-name',table,'--consistent-read','--no-paginate','--limit','100'];
    if(token)args.push('--exclusive-start-key',JSON.stringify(token));
    const data=aws('dynamodb','scan',args);
    for(const row of data.Items||[])all.push(kind==='products'?{
      productId:s(row,'productId'),sku:s(row,'sku'),productName:s(row,'productName'),
      status:s(row,'status'),salePrice:number(row,'salePrice'),published:row.published?.BOOL
    }:{
      productId:s(row,'productId'),quantityOnHand:number(row,'quantityOnHand'),
      reorderPoint:number(row,'reorderPoint'),updatedAt:s(row,'updatedAt')
    });
    token=data.LastEvaluatedKey;
    if(token){
      const key=JSON.stringify(token);
      if(seenTokens.has(key))throw Error('Repeated DynamoDB continuation token. Source NOT verified.');
      seenTokens.add(key);
    }
  }while(token);
  return all;
}
function verify(table) {
  const response=aws('dynamodb','describe-table',['--table-name',table]);
  const row=response.Table;
  if(row?.TableName!==table||row.TableStatus!=='ACTIVE'||
    JSON.stringify(row.KeySchema)!==JSON.stringify([{AttributeName:'productId',KeyType:'HASH'}]))
    throw Error('Wrong or inactive DynamoDB table: '+table);
  const restore=aws('dynamodb','describe-continuous-backups',['--table-name',table]);
  const pitr=restore.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus;
  if(pitr!=='ENABLED')throw Error('PITR must be enabled before any migration review.');
  const backups=aws('dynamodb','list-backups',['--table-name',table]);
  if(!(backups.BackupSummaries||[]).some(b=>b.BackupStatus==='AVAILABLE'))
    throw Error('A verified AVAILABLE on-demand backup is required for '+table);
}
function snapshot() {
  return {products:scanFully(PRODUCT_TABLE,'products'),inventory:scanFully(INVENTORY_TABLE,'inventory'),
    productsComplete:true,inventoryComplete:true};
}
try{
  const id=aws('sts','get-caller-identity');
  if(id.Account!==ACCOUNT)throw Error('Unexpected AWS account; refusing migration preflight.');
  verify(PRODUCT_TABLE);
  verify(INVENTORY_TABLE);
  const baseline=makeStockCutoverReview(snapshot());
  const replay=assertStockCutoverStillCurrent(baseline,snapshot());
  const summary={accountVerified:true,region:REGION,...safeCutoverSummary(baseline),
    twoCompleteReadPassesUnchanged:replay.unchanged,
    fullBackupAndPitrChecked:true};
  process.stdout.write(JSON.stringify(summary,null,2)+'\n');
  process.exitCode=0;
}catch(err){
  console.error('READ-ONLY preflight blocked: '+String(err.message).slice(0,260));
  process.exitCode=1;
}
