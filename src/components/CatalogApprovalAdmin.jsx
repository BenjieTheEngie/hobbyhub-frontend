import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {getCatalogApprovals,changeCatalogApproval} from '../lib/catalogApprovalClient.js';
import './catalog-approval-admin.css';

/** Product publication is separate from both existing Products CRUD and Stock V2. */
export default function CatalogApprovalAdmin({apiBase='',token=''}) {
  const [snapshot,setSnapshot]=useState(null);
  const [state,setState]=useState('disconnected');
  const [filter,setFilter]=useState('all');
  const [search,setSearch]=useState('');
  const [pending,setPending]=useState('');
  const [notice,setNotice]=useState('');
  const ready=Boolean(apiBase&&token);
  const reload=useCallback(async()=>{
    if(!ready){setSnapshot(null);setState('disconnected');return;}
    setState('loading');setNotice('');
    try{
      const response=await getCatalogApprovals(apiBase,token);
      setSnapshot(response);setState('ready');
    }catch(e){setSnapshot(null);setState('unavailable');setNotice(e.message);}
  },[apiBase,token,ready]);
  useEffect(()=>{reload();},[reload]);
  const rows=useMemo(()=>{
    return (snapshot?.items||[]).filter(p=>
      (!search||[p.sku,p.productName].some(t=>t.toLowerCase().includes(search.toLowerCase())))&&
      (filter==='all'||(filter==='published'&&p.approved)||
        (filter==='review'&&!p.approved)||(filter==='changed'&&p.needsReview))
    );
  },[snapshot,search,filter]);
  async function submit(record,action){
    if(!ready||!snapshot?.writesEnabled||pending)return;
    const word=action==='approve'?'APPROVE':'REVOKE';
    if(window.prompt('Type '+word+' to '+(action==='approve'?'approve':'revoke')+
      ' this exact SKU for the public catalog: '+record.sku+
      '\n\nAn AWS audit record will be created. No stock or payment changes will occur.')!==word)return;
    setPending(record.productId);setNotice('');
    try{
      await changeCatalogApproval(apiBase,token,record,action);
      await reload();
      setNotice('AWS confirmed catalog '+(action==='approve'?'approval':'revocation')+' for '+record.sku+'. Publication still requires verified available Stock V2 quantity.');
    }catch(e){setNotice('Change NOT verified: '+e.message+' Refresh before retrying.');}
    finally{setPending('');}
  }
  const items=snapshot?.items||[];
  return <section className="hh-publish" aria-labelledby="hh-publish-title">
    <header className="hh-publish-heading">
      <div><span>PRODUCT RELEASE CONTROL</span><h2 id="hh-publish-title">Catalog publication review</h2>
        <p>Legacy ACTIVE products are not automatically public. Each exact SKU, price, and product identity requires a separate reviewed approval.</p>
      </div>
      <button type="button" className="inv-button inv-button-outline"
        onClick={reload} disabled={!ready||state==='loading'||!!pending}>↻ Refresh approvals</button>
    </header>
    {state==='disconnected'&&<p className="hh-publish-warn">The catalog approval API is not connected. No products have been published by this panel.</p>}
    {state==='loading'&&<p role="status">Checking current AWS catalog approvals…</p>}
    {state==='unavailable'&&<p className="hh-publish-warn" role="alert">Approval service unavailable: {notice}. No edits performed.</p>}
    {state==='ready'&&<>
      <p className="hh-publish-mode" role="status">{snapshot.writesEnabled?
        'Publication changes are enabled on the separate AWS service. Actions require typed confirmation, conditional version checks and audit logs.':
        'Review-only mode: publication writes are DISABLED on the AWS service. No approval or revocation can be submitted.'}</p>
      <div className="hh-publish-stats">
        <div><span>Original products</span><strong>{items.length}</strong></div>
        <div><span>Approved for catalog</span><strong>{items.filter(p=>p.approved).length}</strong></div>
        <div><span>Not approved</span><strong>{items.filter(p=>!p.approved).length}</strong></div>
        <div><span>Review after changes</span><strong>{items.filter(p=>p.needsReview).length}</strong></div>
      </div>
      <div className="hh-publish-filters">
        <label>Search SKU or name<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filter review list"/></label>
        <label>Status<select value={filter} onChange={e=>setFilter(e.target.value)}>
          <option value="all">All products</option><option value="review">Awaiting approval</option>
          <option value="published">Approved</option><option value="changed">Changed since approval</option>
        </select></label>
      </div>
      {rows.length===0?<p className="hh-publish-empty">No matching products. Products cannot be made public without a verified explicit approval.</p>:
      <div className="hh-publish-grid">{rows.map(record=>
        <article className="hh-publish-item" key={record.productId}>
          <div><strong>{record.productName||'Unnamed product'}</strong><small>{record.sku}</small></div>
          <div className="hh-publish-item-status">
            <span>{record.approved?'Approved':record.needsReview?'Changed—reapprove':'Not approved'}</span>
            <b>{record.salePrice==null?'Price unknown':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(record.salePrice)}</b>
          </div>
          <p>{record.duplicateSku?'Duplicate SKU requires reconciliation. ':
            !record.canApprove?'Product metadata needs verification. ':''}
            State: {record.status} · Approval revision {record.approvalRevision}</p>
          <div className="hh-publish-actions">
            <button type="button" disabled={!snapshot.writesEnabled||!record.canApprove||record.approved||!!pending}
              onClick={()=>submit(record,'approve')}>Approve listing</button>
            <button type="button" disabled={!snapshot.writesEnabled||record.approvalRevision===0||!!pending}
              onClick={()=>submit(record,'revoke')}>Revoke approval</button>
          </div>
        </article>)}</div>}
    </>}
    {notice&&state==='ready'&&<p className="hh-publish-feedback" role="status">{notice}</p>}
    <p className="hh-publish-footer">Approval alone does not publish zero-stock products or activate payments. The public catalog additionally requires unique SKU and verified unreserved Stock V2 availability.</p>
  </section>;
}
