import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PILOT_COLUMNS,pilotLedgerTemplate,parsePilotLedger,auditPilotLedger
} from '../src/lib/pilotLedger.js';

const good={
  orderRef:'PILOT-001',productId:'physical-01',sku:'MTG-001',quantity:'2',
  stockCheckedAt:'2026-10-09',parcelMeasured:'YES',usDestinationReviewed:'YES',
  carrierQuoteRef:'carrier_quote_1',taxReviewRef:'tax_1',
  hostedInvoiceRef:'inv_1',providerStatus:'PAID_CONFIRMED',
  paymentEvidenceRef:'provider_evt_1',trackingRef:''
};
function csv(lines){return pilotLedgerTemplate()+lines.map(x=>PILOT_COLUMNS.map(k=>x[k]??'').join(',')).join('\r\n')+'\r\n';}
test('blank template is clean, has no fake orders and no customer PII fields',()=>{
  assert.deepEqual(pilotLedgerTemplate(),PILOT_COLUMNS.join(',')+'\r\n');
  for(const unsafe of ['customer','email','name','address','phone','card','stripeSecret'])
    assert.equal(PILOT_COLUMNS.some(k=>k.toLowerCase().includes(unsafe.toLowerCase())),false);
  const rows=parsePilotLedger(pilotLedgerTemplate());
  assert.deepEqual(rows,[]);
  assert.equal(auditPilotLedger(rows).summary.authoritativeOrders,0);
});
test('complete operator references never authenticate payment, reserve stock or authorize shipment',()=>{
  const row=parsePilotLedger(csv([good]))[0];
  const audit=auditPilotLedger([row]);
  assert.deepEqual(audit.summary,{
    lines:1,orders:1,units:2,incompleteLines:0,completePaperworkLines:1,
    authoritativeOrders:0,paymentAuthorized:false,shipmentAuthorized:false
  });
  assert.equal(audit.findings[0].documentationComplete,true);
  assert.equal(audit.findings[0].paymentVerifiedBySystem,false);
  assert.equal(audit.findings[0].inventoryReserved,false);
  assert.equal(audit.findings[0].canShip,false);
  assert.equal(audit.findings[0].canCharge,false);
});
test('missing carrier, tax, physical stock, packet size, destination and provider references remain blocked',()=>{
  const row={...good,stockCheckedAt:'',parcelMeasured:'NO',usDestinationReviewed:'NO',
    carrierQuoteRef:'',taxReviewRef:'',hostedInvoiceRef:'',providerStatus:'INVOICE_SENT',
    paymentEvidenceRef:''};
  const audit=auditPilotLedger(parsePilotLedger(csv([row])));
  assert.deepEqual(audit.findings[0].issues,[
    'stock-not-reviewed','package-not-measured','us-destination-not-reviewed',
    'carrier-quote-missing','tax-review-missing','hosted-invoice-missing','payment-not-confirmed'
  ]);
  assert.equal(audit.summary.incompleteLines,1);
});
test('claimed provider paid status with no provider evidence cannot pass paperwork review',()=>{
  const audit=auditPilotLedger(parsePilotLedger(csv([{...good,paymentEvidenceRef:''}])));
  assert.ok(audit.findings[0].issues.includes('payment-evidence-missing'));
  assert.equal(audit.findings[0].canShip,false);
});
test('failed, disputed and refunded payment statuses explicitly need reconciliation',()=>{
  for(const providerStatus of ['REFUNDED','FAILED','DISPUTED']){
    const audit=auditPilotLedger(parsePilotLedger(csv([{...good,providerStatus}])));
    assert.ok(audit.findings[0].issues.includes('payment-not-confirmed'));
    assert.ok(audit.findings[0].issues.includes('payment-not-reconciled'));
  }
});
test('multiple order lines share payment references and group into one order',()=>{
  const rows=parsePilotLedger(csv([good,{...good,productId:'physical-02',sku:'PKM-002',quantity:'3'}]));
  const audit=auditPilotLedger(rows);
  assert.equal(audit.summary.orders,1);
  assert.equal(audit.summary.units,5);
  assert.equal(audit.summary.lines,2);
});
test('rejects duplicate immutable productId within same order or ambiguous SKU across records',()=>{
  assert.throws(()=>parsePilotLedger(csv([good,good])),/duplicate order\/productId/);
  assert.throws(()=>parsePilotLedger(csv([good,{...good,orderRef:'PILOT-002',productId:'physical-02'}])),/inconsistent or ambiguous/);
  assert.throws(()=>parsePilotLedger(csv([good,{...good,orderRef:'PILOT-002',sku:'OTHER-SKU'}])),/inconsistent or ambiguous/);
});
test('rejects inconsistent invoice and provider evidence across lines in the same order',()=>{
  const second={...good,sku:'PKM-002',productId:'physical-02',hostedInvoiceRef:'inv_other'};
  assert.throws(()=>parsePilotLedger(csv([good,second])),/payment\/invoice fields conflict/);
});
test('invalid quantities, non-US assumptions and invalid verification dates are rejected',()=>{
  for(const qty of ['0','21','1.5','-1','NaN','01','9007199254740992']){
    assert.throws(()=>parsePilotLedger(csv([{...good,quantity:qty}])),/quantity/);
  }
  for(const invalid of ['2026-02-30','10/09/2026','2026-13-01']){
    assert.throws(()=>parsePilotLedger(csv([{...good,stockCheckedAt:invalid}])),/stockCheckedAt/);
  }
  assert.throws(()=>parsePilotLedger(csv([{...good,usDestinationReviewed:'MAYBE'}])),/usDestinationReviewed/);
});
test('rejects unexpected CSV columns and spreadsheet formula payloads in references',()=>{
  assert.throws(()=>parsePilotLedger('orderRef,sku\nPILOT-001,MTG-1'),/exact unmodified/);
  assert.throws(()=>parsePilotLedger(csv([{...good,hostedInvoiceRef:'=SUM(A1:A2)'}])),/short non-sensitive reference/);
  assert.throws(()=>parsePilotLedger(csv([{...good,hostedInvoiceRef:'@bad'}])),/short non-sensitive reference/);
  assert.throws(()=>parsePilotLedger(csv([{...good,orderRef:'=HYPERLINK'}])),/invalid order reference/);
  assert.throws(()=>parsePilotLedger(csv([{...good,sku:'A,BC'}])),/wrong column count/);
});
test('CSV input stays bounded and rejects malformed quote/newline syntax',()=>{
  assert.throws(()=>parsePilotLedger('x'.repeat(128*1024+1)),/128 KiB/);
  assert.throws(()=>parsePilotLedger(pilotLedgerTemplate()+'"unfinished'),/unclosed quoted/);
  assert.throws(()=>parsePilotLedger(csv([{...good}]).replace('PILOT-001','"PILOT-001"x')),/after a closing quote/);
  assert.throws(()=>parsePilotLedger(csv(Array.from({length:251},(_,i)=>({...good,orderRef:'PILOT-'+i})))),/250 lines/);
});
