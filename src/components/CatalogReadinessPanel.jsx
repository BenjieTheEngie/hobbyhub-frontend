import React,{useMemo,useState} from 'react';
import {catalogReadinessRows,catalogReadinessSummary,PUBLICATION_BLOCKERS} from '../lib/catalogReadiness.js';
import './catalog-readiness.css';

/** Review panel ONLY: never publishes products or changes inventory. */
export default function CatalogReadinessPanel({products=[]}){
  const [filter,setFilter]=useState('blocked');
  const report=useMemo(()=>catalogReadinessRows(products),[products]);
  const totals=useMemo(()=>catalogReadinessSummary(report),[report]);
  const visible=report.filter(r=>filter==='all'||
    (filter==='eligible'&&r.ready)||
    (filter==='blocked'&&!r.ready)||
    (filter==='stock'&&r.issues.includes('stock'))||
    (filter==='packaging'&&r.issues.includes('packaging'))||
    (filter==='publication'&&r.issues.includes('publication')));
  return <section className="hh-catalog-audit" aria-labelledby="hh-catalog-audit-title">
    <header className="hh-catalog-audit-head">
      <div><span>PRELAUNCH / STORE CATALOG</span>
      <h3 id="hh-catalog-audit-title">Publication readiness</h3>
      <p>A conservative, read-only review of which existing products could eventually be sold. It does not approve, publish, price or reserve anything.</p></div>
    </header>
    <div className="hh-catalog-audit-stats">
      <div><small>Ready for sale</small><strong>{totals.eligible}/{totals.total}</strong></div>
      <div><small>Not yet approved</small><strong>{totals.unpublished}</strong></div>
      <div><small>Stock not verified</small><strong>{totals.stockUnverified}</strong></div>
      <div><small>Packed details missing</small><strong>{totals.packagingMissing}</strong></div>
    </div>
    <p className="hh-catalog-audit-alert">A Product with legacy status ACTIVE is <b>not</b> automatically published. ProductId-linked Stock V2 must be verified, and shipping dimensions/weight must be stored on the server before any listing is approved for checkout. Browser-only packaging drafts do not count.</p>
    <div className="hh-catalog-audit-controls">
      <label>Review scope<select value={filter} onChange={e=>setFilter(e.target.value)}>
        <option value="blocked">Blocked listings</option>
        <option value="all">All products</option>
        <option value="eligible">Eligible listings</option>
        <option value="publication">Awaiting publication approval</option>
        <option value="stock">Stock not ready</option>
        <option value="packaging">Shipping details missing</option>
      </select></label>
      <span>{visible.length} record{visible.length===1?'':'s'}</span>
    </div>
    {visible.length===0?<p className="hh-catalog-audit-empty">{products.length?'No products match this readiness filter.':'Load product records from AWS to review publication readiness.'}</p>:
    <div className="hh-catalog-audit-scroll"><table>
      <thead><tr><th>PRODUCT</th><th>STATUS</th><th>REASONS / NEXT STEPS</th></tr></thead>
      <tbody>{visible.map((r)=><tr key={r.productId||'row-'+r.listIndex}>
        <td><b>{r.productName}</b><small>{r.sku||'Missing SKU'}</small></td>
        <td>{r.ready?'Eligible for final review':'Blocked'}</td>
        <td>{r.issues.length?r.issues.map(issue=><span className="hh-catalog-issue" key={issue}>{PUBLICATION_BLOCKERS[issue]}</span>):'No blocking conditions found'}{r.imageAdvisory&&<small className="hh-catalog-image-note">Suggested: add a suitable product image.</small>}</td>
      </tr>)}</tbody>
    </table></div>}
    <p className="hh-catalog-audit-foot">No AWS write, Stripe checkout, stock reservation, or automatic product publication is possible from this panel.</p>
  </section>;
}
