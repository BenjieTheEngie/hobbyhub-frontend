import React,{useCallback,useEffect,useState} from 'react';
import {fetchFirstListingReview} from '../lib/admin-listing-review-client.js';

/** Read-only AWS listing preflight. This component never mutates products, stock or approvals. */
export default function FirstListingReadinessAdmin({apiBase='',token=''}) {
 const [status,setStatus]=useState('disconnected');
 const [report,setReport]=useState(null);
 const [error,setError]=useState('');
 const connected=Boolean(apiBase&&token);
 const refresh=useCallback(async()=>{
  if(!connected){setStatus('disconnected');setReport(null);setError('');return;}
  setStatus('loading');setError('');
  try{const data=await fetchFirstListingReview(apiBase,token);setReport(data);setStatus('ready');}
  catch(e){setReport(null);setError(e.message);setStatus('error');}
 },[apiBase,token,connected]);
 useEffect(()=>{refresh();},[refresh]);
 const checks=report?.inventory?.checks||[];
 const missing=report?.metadata?.missing||[];
 const failed=checks.filter(check=>!check.ok);
 return <section aria-labelledby="first-listing-review-title" className="hh-catalog-audit">
  <header className="hh-catalog-audit-head">
   <div><span>READ ONLY / FIRST LISTING</span><h3 id="first-listing-review-title">Lightning Bolt AWS readiness</h3><p>Live readback from the original product, isolated Stock V2, and publication approval records. This panel cannot publish or alter stock.</p></div>
   <button type="button" disabled={!connected||status==='loading'} onClick={refresh}>Refresh AWS review</button>
  </header>
  {status==='disconnected'&&<p>Not connected. Sign in and configure the read-only staging API to view the live readiness report.</p>}
  {status==='loading'&&<p role="status">Checking AWS records…</p>}
  {status==='error'&&<p role="alert">Readiness could not be verified: {error}</p>}
  {status==='ready'&&report&&<>
   <p role="status"><strong>{report.ready?'Readiness checks passed':'Listing blocked'}</strong> — Live payments remain disabled.</p>
   <p>{checks.filter(check=>check.ok).length} of {checks.length} inventory checks passed. {missing.length} missing metadata field(s). This is a readiness report, not publication approval.</p>
   <ul>{checks.map(c=><li key={c.code}>{c.ok?'✓':'✗'} {c.code}: {c.detail}</li>)}{missing.map(x=><li key={'missing-'+x}>✗ Missing metadata: {x}</li>)}</ul>
   <p>Available units: {report.inventory?.quantityAvailable??'not verified'}. Approval and verified stock are required independently.</p>
   {!report.ready&&<div aria-label="Next steps for listing readiness">
    <h4>Next steps before launch</h4>
    {missing.length>0&&<p><strong>Product details:</strong> Confirm {missing.join(', ')} against the physical card before editing the exact product record. Do not guess its variant.</p>}
    {failed.some(c=>c.code==='verified-stock'||c.code==='physical-count')&&<p><strong>Inventory:</strong> Count and inspect the actual card when available. Stock V2 is not yet verified; this panel cannot initialize or adjust stock.</p>}
    {failed.some(c=>c.code==='publication-approval')&&<p><strong>Approval:</strong> Publication requires a separate, explicit approval after product details and stock are verified. Nothing here publishes a listing.</p>}
    <p>US-only carrier-calculated shipping still requires verified packed weight and dimensions. Checkout and live payments remain disabled until independently tested and approved.</p>
   </div>}
  </>}
 </section>;
}
