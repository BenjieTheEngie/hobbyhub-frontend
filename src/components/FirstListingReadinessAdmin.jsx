import React,{useCallback,useEffect,useState} from 'react';
import {fetchFirstListingReview} from '../lib/admin-listing-review-client.js';
/** Read-only, opt-in authenticated AWS listing preflight; never performs mutations. */
export default function FirstListingReadinessAdmin({apiBase='',token=''}){
 const [status,setStatus]=useState('disconnected');const [report,setReport]=useState(null);const [error,setError]=useState('');
 const connected=Boolean(apiBase&&token);
 const refresh=useCallback(async()=>{if(!connected){setStatus('disconnected');setReport(null);return;}setStatus('loading');setError('');try{const data=await fetchFirstListingReview(apiBase,token);setReport(data);setStatus('ready')}catch(e){setReport(null);setError(e.message);setStatus('error')}},[apiBase,token,connected]);
 useEffect(()=>{refresh()},[refresh]);
 return <section aria-labelledby="first-listing-review-title" className="hh-catalog-audit">
  <header className="hh-catalog-audit-head"><div><span>READ ONLY / FIRST LISTING</span><h3 id="first-listing-review-title">Lightning Bolt AWS readiness</h3><p>Live readback from the original product, isolated Stock V2, and publication approval records. This panel cannot publish or alter stock.</p></div><button type="button" disabled={!connected||status==='loading'} onClick={refresh}>Refresh AWS review</button></header>
  {status==='disconnected'&&<p>Not connected. Configure VITE_FIRST_LISTING_READ_API_BASE_URL after deploying the separate read-only admin API.</p>}
  {status==='loading'&&<p role="status">Checking AWS records…</p>}
  {status==='error'&&<p role="alert">Readiness could not be verified: {error}</p>}
  {status==='ready'&&report&&<><p role="status"><strong>{report.ready?'Readiness checks passed':'Listing blocked'}</strong> — Live payments remain disabled.</p><ul>{(report.inventory?.checks||[]).map(c=><li key={c.code}>{c.ok?'✓':'✗'} {c.code}: {c.detail}</li>)}{(report.metadata?.missing||[]).map(x=><li key={'missing-'+x}>✗ Missing metadata: {x}</li>)}</ul><p>Available units: {report.inventory?.quantityAvailable??'not verified'}. Approval and verified stock are required independently.</p></>}
 </section>;
}
