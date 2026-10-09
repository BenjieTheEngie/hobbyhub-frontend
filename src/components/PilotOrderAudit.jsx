import React,{useMemo,useState} from 'react';
import {
  pilotLedgerTemplate,parsePilotLedger,auditPilotLedger,PILOT_REVIEW_LABELS
} from '../lib/pilotLedger.js';
import './pilot-order-audit.css';

/**
 * Signed-in admin preparation UI. Local file input and transient React state
 * only: no localStorage, backend requests, payment mutations or AWS reads.
 */
export default function PilotOrderAudit(){
  const [rows,setRows]=useState([]);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [loaded,setLoaded]=useState(false);
  const report=useMemo(()=>auditPilotLedger(rows),[rows]);
  function downloadTemplate(){
    const url=URL.createObjectURL(new Blob([pilotLedgerTemplate()],{type:'text/csv;charset=utf-8'}));
    const anchor=document.createElement('a');
    anchor.href=url;anchor.download='hobbyhub-pilot-order-paperwork-template.csv';
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    // Safari/iOS may resolve the download asynchronously after the click.
    window.setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  async function readCsv(event){
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file)return;
    setError('');setNotice('');setRows([]);setLoaded(false);
    if(file.size>128*1024){setError('CSV exceeds the 128 KiB audit limit.');return;}
    try{
      const parsed=parsePilotLedger(await file.text());
      setRows(parsed);setLoaded(true);
      setNotice('Reviewed '+parsed.length+' worksheet line(s) in this browser only. No live orders or stock reservations were created.');
    }catch(e){setError(e.message||'Worksheet could not be validated.');}
  }
  return <section className="hh-pilot-audit" aria-labelledby="hh-pilot-audit-title">
    <header>
      <span className="hh-pilot-eyebrow">OCTOBER 16 PILOT / OFFLINE OPERATIONAL PREP</span>
      <h2 id="hh-pilot-audit-title">Manual sales paperwork audit</h2>
      <p>Use a redacted CSV to spot missing shipping, stock and hosted-payment references before human review. This is <strong>not an order processing system</strong> and cannot authorize sales, refunds or shipments.</p>
    </header>
    <div className="hh-pilot-warning" role="note">
      <strong>No cardholder details or personal customer information.</strong>
      <p>Keep customer names, emails, street addresses, phone numbers and payment credentials out of this worksheet. Track those in an approved payment/shipping service. The browser does not save or send CSV contents; closing this admin view clears the imported report.</p>
    </div>
    <div className="hh-pilot-actions">
      <button type="button" onClick={downloadTemplate}>Download blank CSV template</button>
      <label className="hh-pilot-upload">Audit completed CSV locally
        <input type="file" accept=".csv,text/csv" onChange={readCsv} aria-label="Choose a redacted pilot order CSV"/>
      </label>
      {loaded&&<button type="button" className="hh-pilot-clear" onClick={()=>{setRows([]);setLoaded(false);setNotice('Worksheet review cleared from this browser session.');}}>Clear review</button>}
    </div>
    {error&&<p role="alert" className="hh-pilot-error">{error}</p>}
    {notice&&<p role="status" className="hh-pilot-notice">{notice}</p>}
    <div className="hh-pilot-metrics">
      <div><span>CSV orders reviewed</span><strong>{loaded?report.summary.orders:'—'}</strong></div>
      <div><span>Worksheet units</span><strong>{loaded?report.summary.units:'—'}</strong></div>
      <div><span>Incomplete lines</span><strong>{loaded?report.summary.incompleteLines:'—'}</strong></div>
      <div><span>Authorized shipments</span><strong>0</strong></div>
    </div>
    {!loaded?<p className="hh-pilot-empty">No operator worksheet loaded. Start with the blank CSV template, and use one line per order and immutable productId.</p>:
      rows.length===0?<p className="hh-pilot-empty">Worksheet contains no orders. No paid orders are inferred.</p>:
      <div className="hh-pilot-table-wrap"><table>
        <thead><tr><th>Order / Product</th><th>Reported provider state</th><th>Missing audit evidence</th></tr></thead>
        <tbody>{report.findings.slice(0,100).map((x,i)=><tr key={x.orderRef+'-'+x.productId+'-'+i}>
          <td><strong>{x.orderRef}</strong><small>{x.productId} · {x.sku} · {x.quantity} unit(s)</small></td>
          <td>{x.reportedPaymentStatus.replaceAll('_',' ')}</td>
          <td>{x.issues.length?x.issues.map(k=>PILOT_REVIEW_LABELS[k]).join(' · '):'Operator references filled — verify externally; not permission to ship'}</td>
        </tr>)}</tbody>
      </table>{report.findings.length>100&&<p>Showing 100 of {report.findings.length} lines; review the CSV directly for the rest.</p>}</div>}
    <p className="hh-pilot-footer">Payment verification must happen inside the authorized provider account. Stock must be freshly reconciled with the original Inventory table and other sales channels. Only the approved merchant can authorize a limited paid pilot; this tool never reserves stock or verifies provider references.</p>
  </section>;
}
