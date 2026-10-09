/**
 * PILOT ORDER PAPERWORK AUDITOR — browser-only and offline.
 *
 * NOT an order ledger, payment provider, stock reservation, fulfillment
 * system, or authoritative source of inventory. This validates an operator's
 * REDACTED CSV worksheet for missing evidence before separate manual review.
 * No customer names, addresses, phone numbers or payment card data.
 */
export const PILOT_COLUMNS=Object.freeze([
  'orderRef','productId','sku','quantity','stockCheckedAt',
  'parcelMeasured','usDestinationReviewed','carrierQuoteRef','taxReviewRef',
  'hostedInvoiceRef','providerStatus','paymentEvidenceRef','trackingRef'
]);
export const PILOT_PROVIDER_STATUSES=Object.freeze([
  'NOT_REQUESTED','INVOICE_SENT','PAID_CONFIRMED','FAILED','REFUNDED','DISPUTED'
]);
export const PILOT_REVIEW_LABELS=Object.freeze({
  'stock-not-reviewed':'Original Inventory quantity and other channel sales require fresh human verification',
  'package-not-measured':'Packed weight and dimensions have not been approved',
  'us-destination-not-reviewed':'U.S. destination eligibility has not been manually reviewed',
  'carrier-quote-missing':'Actual production carrier quote reference is missing',
  'tax-review-missing':'Applicable tax review reference is missing',
  'hosted-invoice-missing':'External hosted invoice reference is missing',
  'payment-not-confirmed':'Provider payment status is not marked PAID_CONFIRMED',
  'payment-evidence-missing':'Provider-side payment confirmation reference is missing',
  'payment-not-reconciled':'Refunded, failed or disputed payment requires manual review'
});
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SKU=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const ORDER=/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const MAX_CSV_BYTES=128*1024;
const MAX_ROWS=250;

export function pilotLedgerTemplate(){return PILOT_COLUMNS.join(',')+'\r\n';}

function csvRecords(input){
  const records=[];let row=[],cell='',quoted=false,afterQuote=false;
  const data=input.replace(/^\uFEFF/,'');
  for(let i=0;i<data.length;i++){
    const ch=data[i];
    if(quoted){
      if(ch==='"'&&data[i+1]==='"'){cell+='"';i++;}
      else if(ch==='"'){quoted=false;afterQuote=true;}
      else cell+=ch;
    }else if(ch==='"'){
      if(cell||afterQuote)throw Error('CSV contains unexpected quote characters.');
      quoted=true;
    }else if(ch===','){
      row.push(cell);cell='';afterQuote=false;
    }else if(ch==='\n'||ch==='\r'){
      if(ch==='\r'&&data[i+1]==='\n')i++;
      row.push(cell);
      if(row.some(x=>x!==''))records.push(row);
      row=[];cell='';afterQuote=false;
    }else{
      if(afterQuote)throw Error('CSV contains text after a closing quote.');
      cell+=ch;
    }
  }
  if(quoted)throw Error('CSV contains an unclosed quoted cell.');
  row.push(cell);
  if(row.some(x=>x!==''))records.push(row);
  return records;
}
function dateOnly(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function validateRef(value,column,line,optional=false){
  if(optional&&!value)return;
  if(!REF.test(value))throw Error('Row '+line+': '+column+' must be a short non-sensitive reference.');
}
export function parsePilotLedger(input){
  if(typeof input!=='string'||input.length>MAX_CSV_BYTES)
    throw Error('Pilot CSV must be text under 128 KiB.');
  const records=csvRecords(input);
  if(!records.length)throw Error('Pilot CSV requires the official header.');
  if(records[0].length!==PILOT_COLUMNS.length||PILOT_COLUMNS.some((h,i)=>records[0][i]!==h))
    throw Error('Pilot CSV must use the exact unmodified template header.');
  if(records.length-1>MAX_ROWS)throw Error('Pilot CSV review is limited to 250 lines.');
  const byOrderAndProduct=new Set(),productSku=new Map(),skuProduct=new Map(),orderFields=new Map();
  const rows=records.slice(1).map((fields,index)=>{
    const line=index+2;
    if(fields.length!==PILOT_COLUMNS.length)throw Error('Row '+line+': wrong column count.');
    const row=Object.fromEntries(PILOT_COLUMNS.map((h,i)=>[h,fields[i].trim()]));
    if(!ORDER.test(row.orderRef))throw Error('Row '+line+': invalid order reference.');
    if(!ID.test(row.productId))throw Error('Row '+line+': invalid physical productId.');
    if(!SKU.test(row.sku))throw Error('Row '+line+': invalid SKU.');
    if(!/^[1-9]\d*$/.test(row.quantity)||!Number.isSafeInteger(Number(row.quantity))||
      Number(row.quantity)>20)throw Error('Row '+line+': quantity must be 1–20 whole units.');
    if(row.stockCheckedAt&&!dateOnly(row.stockCheckedAt))
      throw Error('Row '+line+': stockCheckedAt must be a valid YYYY-MM-DD date.');
    for(const field of ['parcelMeasured','usDestinationReviewed'])
      if(!['YES','NO'].includes(row[field]))throw Error('Row '+line+': '+field+' must be YES or NO.');
    if(!PILOT_PROVIDER_STATUSES.includes(row.providerStatus))
      throw Error('Row '+line+': invalid payment provider status.');
    for(const field of ['carrierQuoteRef','taxReviewRef','hostedInvoiceRef','paymentEvidenceRef','trackingRef'])
      validateRef(row[field],field,line,true);
    const id=row.orderRef.toLowerCase()+'\u0000'+row.productId;
    if(byOrderAndProduct.has(id))throw Error('Row '+line+': duplicate order/productId; consolidate quantities.');
    byOrderAndProduct.add(id);
    const normalizedSku=row.sku.toLowerCase();
    if((productSku.has(row.productId)&&productSku.get(row.productId)!==normalizedSku)||
       (skuProduct.has(normalizedSku)&&skuProduct.get(normalizedSku)!==row.productId))
      throw Error('Row '+line+': productId and SKU mapping is inconsistent or ambiguous.');
    productSku.set(row.productId,normalizedSku);
    skuProduct.set(normalizedSku,row.productId);
    const summary=[row.hostedInvoiceRef,row.providerStatus,row.paymentEvidenceRef].join('|');
    if(orderFields.has(row.orderRef.toLowerCase())&&orderFields.get(row.orderRef.toLowerCase())!==summary)
      throw Error('Row '+line+': payment/invoice fields conflict within the same order.');
    orderFields.set(row.orderRef.toLowerCase(),summary);
    return Object.freeze({...row,quantity:Number(row.quantity)});
  });
  return rows;
}
export function auditPilotLedger(rows){
  if(!Array.isArray(rows))throw Error('Pilot rows must come from CSV validation.');
  const findings=rows.map(row=>{
    const issues=[];
    if(!row.stockCheckedAt)issues.push('stock-not-reviewed');
    if(row.parcelMeasured!=='YES')issues.push('package-not-measured');
    if(row.usDestinationReviewed!=='YES')issues.push('us-destination-not-reviewed');
    if(!row.carrierQuoteRef)issues.push('carrier-quote-missing');
    if(!row.taxReviewRef)issues.push('tax-review-missing');
    if(!row.hostedInvoiceRef)issues.push('hosted-invoice-missing');
    if(row.providerStatus!=='PAID_CONFIRMED')issues.push('payment-not-confirmed');
    if(row.providerStatus==='PAID_CONFIRMED'&&!row.paymentEvidenceRef)issues.push('payment-evidence-missing');
    if(['REFUNDED','FAILED','DISPUTED'].includes(row.providerStatus))issues.push('payment-not-reconciled');
    return Object.freeze({
      orderRef:row.orderRef,productId:row.productId,sku:row.sku,quantity:row.quantity,
      reportedPaymentStatus:row.providerStatus,issues,
      // Even complete operator-entered references cannot authenticate payment,
      // reserve inventory, validate a carrier quote, or authorize shipping.
      documentationComplete:issues.length===0,inventoryReserved:false,
      paymentVerifiedBySystem:false,canCharge:false,canShip:false
    });
  });
  return {
    findings,
    summary:{
      lines:findings.length,orders:new Set(findings.map(x=>x.orderRef.toLowerCase())).size,
      units:findings.reduce((n,x)=>n+x.quantity,0),
      incompleteLines:findings.filter(x=>x.issues.length>0).length,
      completePaperworkLines:findings.filter(x=>x.documentationComplete).length,
      authoritativeOrders:0,paymentAuthorized:false,shipmentAuthorized:false
    }
  };
}
