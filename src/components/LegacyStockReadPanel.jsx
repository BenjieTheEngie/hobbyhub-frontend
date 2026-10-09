import React,{useMemo,useState} from 'react';
import {fetchLegacyStockReadOnly} from '../lib/legacyStockReadClient.js';
import {joinLegacyReadOnlyStock,legacyStockSummary} from '../../backend/legacy-stock-read-logic.mjs';

/**
 * Safe optional snapshot of the ORIGINAL inventory source. Separate from
 * Stock V2 adjustments; no orders, reservations, checkout or edit controls.
 */
export default function LegacyStockReadPanel({products=[],apiBase='',token=''}) {
  const [items,setItems]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [lastRead,setLastRead]=useState(null);
  const connected=Boolean(apiBase&&token);
  const report=useMemo(()=>{
    if(!items)return null;
    try {
      const joined=joinLegacyReadOnlyStock(products,items);
      return {joined,summary:legacyStockSummary(joined)};
    }catch(e){return {error:e.message};}
  },[items,products]);
  async function load(){
    if(!connected||busy)return;
    setBusy(true);setError('');setItems(null);
    try{
      const result=await fetchLegacyStockReadOnly(apiBase,token);
      setItems(result);setLastRead(new Date().toISOString());
    }catch(e){setError(e.message||'Legacy inventory verification failed.');}
    finally{setBusy(false);}
  }
  return <section className="hh-legacy-stock-read" aria-labelledby="hh-legacy-stock-heading">
    <header className="hh-legacy-read-top">
      <div><span>STOCK SOURCE AUDIT</span><h3 id="hh-legacy-stock-heading">Original Inventory balances</h3>
        <p>Read-only view of the legacy DynamoDB Inventory table. These physical counts are not checkout reservations or sellable Stock V2 balances.</p></div>
      <button type="button" className="inv-button inv-button-outline" onClick={load} disabled={!connected||busy}>
        {busy?'Verifying AWS…':'Refresh legacy inventory'}
      </button>
    </header>
    {!connected&&<p className="hh-legacy-message">This view needs the separately deployed read-only AWS API. Your existing product management remains unchanged.</p>}
    {error&&<p role="alert" className="hh-legacy-error">{error} No stock has been changed.</p>}
    {report?.error&&<p role="alert" className="hh-legacy-error">Inventory reconciliation blocked: {report.error}. Do not migrate unknown stock.</p>}
    {report?.joined&&<div>
      <div className="hh-legacy-summary">
        <div><small>Linked products</small><strong>{report.summary.verified}</strong></div>
        <div><small>Original on hand</small><strong>{report.summary.total}</strong></div>
        <div><small>At/below reorder</small><strong>{report.summary.lowStock}</strong></div>
        <div><small>Unknown</small><strong>{report.summary.unknown}</strong></div>
      </div>
      <p className="hh-legacy-message">Last verified: {lastRead?new Date(lastRead).toLocaleString():'Unknown'} · No AWS writes performed.</p>
      <div className="hh-legacy-scroll"><table className="hh-legacy-table">
        <thead><tr><th>Product</th><th>SKU</th><th>On hand</th><th>Reorder point</th><th>Last stock update</th></tr></thead>
        <tbody>{report.joined.map(p=><tr key={p.productId}>
          <td>{p.productName}</td><td>{p.sku}</td>
          <td>{p.countVerified?p.quantityOnHand:'Unknown'}</td>
          <td>{p.countVerified?p.reorderPoint:'Unknown'}</td>
          <td>{p.updatedAt?new Date(p.updatedAt).toLocaleDateString():'Unknown'}</td>
        </tr>)}</tbody>
      </table></div>
    </div>}
    <p className="hh-legacy-footer">No stock adjustments, publication, checkout, shipping labels, or migration can be performed from this panel.</p>
  </section>;
}
