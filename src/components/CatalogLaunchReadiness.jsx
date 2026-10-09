import React,{useMemo} from 'react';
import {catalogLaunchReview,READINESS_LABELS} from '../lib/catalogLaunchReadiness.js';
import './catalog-launch-readiness.css';

export default function CatalogLaunchReadiness({products=[]}){
  const {rows,summary}=useMemo(()=>catalogLaunchReview(products),[products]);
  return <section className="hh-catalog-audit" aria-labelledby="hh-catalog-audit-title">
    <div className="hh-catalog-audit-head">
      <span className="inv-eyebrow">STORE LAUNCH PREPARATION · READ ONLY</span>
      <h3 id="hh-catalog-audit-title">Publication & checkout readiness</h3>
      <p>Review which product records have verified publication, price, stock and packed dimensions. This does not publish a product, reserve stock or enable checkout.</p>
    </div>
    <div className="hh-catalog-readiness-metrics">
      <div><small>Product records</small><strong>{summary.total}</strong></div>
      <div><small>Catalog candidates</small><strong>{summary.catalogCandidates}</strong></div>
      <div><small>Carrier checkout candidates</small><strong>{summary.carrierCheckoutCandidates}</strong></div>
      <div><small>Awaiting publication approval</small><strong>{summary.unapproved}</strong></div>
    </div>
    <p className="hh-catalog-audit-warning">Payments are OFF for every product, even if catalog checks pass. Browser-local packaging measurements do not count as verified AWS shipping profiles, and original Inventory counts do not count as Stock V2.</p>
    <details className="hh-catalog-detail">
      <summary>Review product-level launch blockers ({rows.filter(r=>r.blockers.length).length} records)</summary>
      {rows.length===0?<p>No authenticated products have been loaded yet.</p>:
      <div className="hh-catalog-table-scroll"><table>
        <thead><tr><th>Product</th><th>Catalog</th><th>Carrier checkout</th><th>Required steps</th></tr></thead>
        <tbody>{rows.slice(0,500).map((r,i)=><tr key={r.key+'-'+i}>
          <td><strong>{r.productName}</strong><small>{r.sku||'SKU missing'}</small></td>
          <td>{r.catalogCandidate?'Checks pass':'Blocked'}</td>
          <td>{r.carrierCheckoutCandidate?'Checks pass':'Blocked'}</td>
          <td>{r.blockers.length?r.blockers.map(code=>READINESS_LABELS[code]).join(' · '):'No product-data blockers; payments still disabled'}</td>
        </tr>)}</tbody>
      </table></div>}
      {rows.length>500&&<p>Showing the first 500 product records only. Review the full authenticated inventory separately.</p>}
    </details>
  </section>;
}
