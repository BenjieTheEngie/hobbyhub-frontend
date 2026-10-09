import React,{useMemo,useState,useEffect} from 'react';
import {INVENTORY_VIEWS,inventorySummary,inventorySearch,inventoryAuditCsv,productIssues,skuCounts,recordKey,money} from '../lib/inventoryAnalytics.js';
import {isArchived} from '../lib/inventoryStatus.js';
import {safeRecordLabel} from '../lib/legacyInventory.js';
import {packagingWorksheetCsv,packagingReadiness} from '../lib/packagingWorksheet.js';
import StockControls from './StockControls.jsx';
import './inventory-workspace.css';

const issueLabels={
  'duplicate-sku':'Duplicate SKU','unknown-stock':'Stock unknown',
  'invalid-price':'Invalid price','zero-price':'Zero price','missing-sku':'Missing SKU',
  'missing-name':'Missing name','missing-identity':'ID missing','low-stock':'Low stock',
};
function downloadAudit(records) {
  const csv=inventoryAuditCsv(records);
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');
  a.href=url;a.download='hobbyhub-inventory-audit-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function ProductInitial({product}) {
  const [broken,setBroken]=useState(false);
  return <div className="inv-thumb">
    {product.imageUrl && !broken ? <img src={product.imageUrl} alt="" loading="lazy" onError={()=>setBroken(true)}/> :
      <span aria-hidden="true">{(product.productName||'?').trim().charAt(0).toUpperCase()}</span>}
  </div>;
}
export default function InventoryWorkspace({products=[],isLegacy=true,onEdit,onNew,onArchive,onRestore,onReload,busy=false,busyId='',notice='',editorSku=null,stockStatus='unconfigured',stockBusyId='',stockInitializeEnabled=false,stockWritesEnabled=false,onStockAdjust,onStockInitialize}) {
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState('All');
  const [view,setView]=useState('all');
  const [sort,setSort]=useState('issues');
  const [page,setPage]=useState(1);
  const [selected,setSelected]=useState(null);
  const [deletionAcknowledged,setDeletionAcknowledged]=useState(false);
  const [exportMessage,setExportMessage]=useState('');
  const summary=useMemo(()=>inventorySummary(products),[products]);
  const packaging=useMemo(()=>packagingReadiness(products),[products]);
  const counts=useMemo(()=>skuCounts(products),[products]);
  const visible=useMemo(()=>inventorySearch(products,{query,category,view,sort}),[products,query,category,view,sort]);
  const pageSize=20;
  const pageCount=Math.max(1,Math.ceil(visible.length/pageSize));
  useEffect(()=>setPage(1),[query,category,view,sort]);
  useEffect(()=>{if(page>pageCount)setPage(pageCount);},[page,pageCount]);
  const rows=visible.slice((page-1)*pageSize,page*pageSize);
  const selectedRecord=products.find((product,index)=>recordKey(product,index)===selected) || null;
  const selectedIssues=selectedRecord?productIssues(selectedRecord,counts):[];
  const duplicates=useMemo(()=>{
    const grouped=new Map();
    for(const p of products) {
      const sku=String(p.sku||'').toLowerCase();
      if((counts.get(sku)||0)>1){
        const group=grouped.get(sku)||{sku:p.sku,count:0,names:new Set()};
        group.count++;group.names.add(p.productName||'Unnamed product');grouped.set(sku,group);
      }
    }
    return [...grouped.values()].sort((a,b)=>b.count-a.count).slice(0,6);
  },[products,counts]);
  function openRecord(p) {setDeletionAcknowledged(false);setSelected(recordKey(p,products.indexOf(p)));}
  function closeRecord() {setDeletionAcknowledged(false);setSelected(null);}
  function requestLegacyRemoval() {
    if (!isLegacy || !selectedRecord?.productId || !deletionAcknowledged || busy)return;
    const record=selectedRecord;
    closeRecord();
    onArchive(record); // The app requires a second typed DELETE confirmation.
  }
  function startAuditExport() {
    downloadAudit(visible);
    setExportMessage('Downloaded '+visible.length+' matching records. Nothing was changed in AWS.');
  }
  function exportPackagingMeasurements(){
    try{
      const csv=packagingWorksheetCsv(visible);
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
      const a=document.createElement('a');
      a.href=url;
      a.download='hobbyhub-packed-dimensions-'+new Date().toISOString().slice(0,10)+'.csv';
      document.body.appendChild(a);a.click();a.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),2000);
      setExportMessage('Downloaded '+visible.length+' exact product records for packed shipping measurements. The CSV has not been saved to AWS.');
    }catch(e){setExportMessage('Packaging export stopped: '+e.message);}
  }
  function resetFilters() {setView('all');setCategory('All');setQuery('');setSort('issues');setPage(1);}
  return <section className="inv-workspace" aria-labelledby="inv-workspace-title">
    <div className="inv-heading">
      <div><span className="inv-eyebrow">HOBBY HUB / OPERATIONS</span>
        <h2 id="inv-workspace-title">Inventory command center</h2>
        <p>One workspace for product records, quality checks and preparation for a clean inventory migration.</p>
      </div>
      <div className="inv-heading-actions">
        <button type="button" className="inv-button inv-button-light" onClick={onReload} disabled={busy}>↻ Refresh records</button>
        <button type="button" className="inv-button inv-button-primary" onClick={onNew}>+ New product</button>
      </div>
    </div>

    <div className={'inv-banner '+(isLegacy?'inv-banner-warning':'inv-banner-ready')} role="status">
      <span className="inv-banner-icon" aria-hidden="true">{isLegacy?'!':'✓'}</span>
      <div><strong>{isLegacy?'Legacy AWS inventory detected':'Inventory API connected'}</strong>
        <p>{isLegacy?'Products are keyed by productId, not SKU. Historical duplicate SKUs and unverified stock exist. Removal is available from the selected record’s Review panel only after you verify backups and related inventory. The legacy DELETE action may permanently erase that record.':'Each SKU must be unique before using archive or restore. Changes require a verified backend.'}</p>
      </div>
      <span className="inv-banner-tag">{isLegacy?'AUDIT / REVIEW':'MANAGED MODE'}</span>
    </div>

    <div className="inv-stats" aria-label="Inventory summary">
      <div className="inv-stat"><span>Product records</span><strong>{summary.records}</strong><small>From authenticated AWS API</small></div>
      <div className="inv-stat"><span>Unique SKU labels</span><strong>{summary.uniqueSkus}</strong><small>Not individual product IDs</small></div>
      <div className="inv-stat inv-stat-alert"><span>Needs review</span><strong>{summary.review}</strong><small>Records with data warnings</small></div>
      <div className="inv-stat"><span>Duplicate SKU groups</span><strong>{summary.duplicateSkus}</strong><small>{summary.unknownStock} unknown-stock records</small></div>
      <div className="inv-stat"><span>Low stock</span><strong>{summary.lowStock}</strong><small>Verified counts at or below reorder points</small></div>
      <div className="inv-stat"><span>Shipping packaging</span><strong>{packaging.ready}/{packaging.total}</strong><small>{packaging.missing} missing measurements · {packaging.ambiguous} need IDs</small></div>
    </div>

    <div className="inv-body">
      <div className="inv-side" aria-label="Inventory views">
        <div className="inv-side-title">WORKSPACES</div>
        {INVENTORY_VIEWS.map(([key,label])=>{
          const total=key==='all'?summary.records:key==='review'?summary.review:key==='duplicates'?products.filter(p=>(counts.get(String(p.sku||'').toLowerCase())||0)>1).length:key==='missing-stock'?summary.unknownStock:key==='low-stock'?summary.lowStock:key==='invalid-price'?summary.priceIssues:summary.archived;
          return <button type="button" key={key} className={'inv-view '+(view===key?'inv-view-active':'')} aria-pressed={view===key} onClick={()=>setView(key)}><span>{label}</span><span className="inv-view-count">{total}</span></button>;
        })}
        <div className="inv-side-divider"/>
        <div className="inv-side-title">DUPLICATE GROUPS</div>
        {duplicates.length===0?<p className="inv-sidebar-empty">No duplicate SKUs detected.</p>:
          duplicates.map(group=><button type="button" key={group.sku} className="inv-duplicate-link" onClick={()=>{setView('duplicates');setQuery(group.sku);setCategory('All');}}>
            <span>{group.sku}</span><b>{group.count} records</b>
          </button>)}
        <div className="inv-side-divider"/>
        <div className="inv-help-box"><strong>About stock</strong><p>{stockStatus==='ready'?'Connected to versioned stock balances keyed by productId. Open a record to review or adjust quantities.':'Stock adjustments use a separate verified service. Legacy product edits and removal stay unchanged until it is connected.'}</p></div>
      </div>
      <div className="inv-main">
        <div className="inv-toolbar">
          <label className="inv-search"><span>Search products, SKU or product ID</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, SKU, set or record ID…"/></label>
          <label><span>Category</span><select value={category} onChange={e=>setCategory(e.target.value)}><option>All</option>{summary.categories.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
          <label><span>Sort</span><select value={sort} onChange={e=>setSort(e.target.value)}><option value="issues">Most issues</option><option value="name">Product name</option><option value="sku">SKU</option><option value="newest">Newest created</option><option value="price-low">Lowest price</option><option value="price-high">Highest price</option></select></label>
        </div>
        <div className="inv-results-header"><span><strong>{visible.length}</strong> matching record{visible.length===1?'':'s'} · page {page} of {pageCount}</span>
          <div><button type="button" className="inv-link-button" onClick={resetFilters}>Clear filters</button><button type="button" className="inv-button inv-button-outline" onClick={startAuditExport} disabled={visible.length===0}>↓ Export filtered audit</button><button type="button" className="inv-button inv-button-outline" onClick={exportPackagingMeasurements} disabled={visible.length===0}>↓ Packaging worksheet</button></div>
        </div>
        {notice&&<p className="inv-feedback" role="status">{notice}</p>}
        {exportMessage&&<p className="inv-feedback" role="status">{exportMessage}</p>}
        <div className="inv-table-scroll">
          <table className="inv-table"><thead><tr><th>PRODUCT / RECORD</th><th>CATEGORY</th><th>PRICE</th><th>STOCK</th><th>QUALITY</th><th aria-label="Actions"/></tr></thead>
            <tbody>{rows.map((p)=>{
              const issues=productIssues(p,counts);
              const key=recordKey(p,products.indexOf(p));
              const archived=isArchived(p);
              return <tr key={key} className={editorSku===p.sku?'inv-editing-row':''}>
                <td><div className="inv-product-cell"><ProductInitial product={p}/><div><strong>{p.productName||'Unnamed record'}</strong><small>SKU: {p.sku||'Missing'} · {p.productId?safeRecordLabel(p):'ID unverified'}</small><small>{p.createdAt?'Created '+p.createdAt.slice(0,10):'Date not reported'}</small></div></div></td>
                <td><span className="inv-cell-category">{p.category||'Uncategorized'}</span></td>
                <td><strong className={p.priceInvalid?'inv-bad-price':''}>{p.priceInvalid?'Review: '+String(p.rawSalePrice??p.salePrice):money(p.salePrice)}</strong></td>
                <td>{p.stockReported===true?<div><b className="inv-stock">{p.quantityOnHand}</b>{p.reorderPoint>0&&p.quantityOnHand<=p.reorderPoint&&<small className="inv-stock-low">Low · reorder at {p.reorderPoint}</small>}</div>:<span className="inv-muted-status">Not verified</span>}</td>
                <td><div className="inv-issue-stack">{archived&&<span className="inv-chip inv-chip-neutral">Archived</span>}{issues.slice(0,2).map(issue=><span key={issue} className={'inv-chip '+(issue==='duplicate-sku'||issue==='invalid-price'?'inv-chip-danger':'inv-chip-warn')}>{issueLabels[issue]}</span>)}{issues.length>2&&<small>+{issues.length-2} more</small>}{!issues.length&&!archived&&<span className="inv-chip inv-chip-ok">No flagged issues</span>}</div></td>
                <td><div className="inv-cell-actions"><button type="button" className="inv-button inv-button-light" onClick={()=>openRecord(p)}>{isLegacy?"Review / remove":"Review"}</button></div></td>
              </tr>;
            })}</tbody></table>
          {rows.length===0&&<div className="inv-empty"><span aria-hidden="true">◇</span><h3>{products.length?'No records match these filters':'No inventory records loaded'}</h3><p>{products.length?'Adjust the search or open another workspace.':'Sign in, then choose Refresh records to retrieve the current AWS products.'}</p><button type="button" className="inv-button inv-button-light" onClick={products.length?resetFilters:onReload}>{products.length?'Reset filters':'Load records'}</button></div>}
        </div>
        {pageCount>1&&<div className="inv-pagination"><button type="button" className="inv-button inv-button-light" disabled={page<=1} onClick={()=>setPage(n=>n-1)}>← Previous</button><span>Showing {(page-1)*pageSize+1}–{Math.min(page*pageSize,visible.length)} of {visible.length}</span><button type="button" className="inv-button inv-button-light" disabled={page>=pageCount} onClick={()=>setPage(n=>n+1)}>Next →</button></div>}
        <div className="inv-footer">Exports are generated locally from the products already loaded in this browser. No AWS write or delete requests are made by searching, reviewing or exporting.</div>
      </div>
    </div>

    {selectedRecord&&<div className="inv-modal-backdrop" role="presentation" onClick={closeRecord}>
      <section role="dialog" aria-modal="true" aria-labelledby="inv-dialog-title" className="inv-dialog" onClick={e=>e.stopPropagation()}>
        <button type="button" className="inv-dialog-close" aria-label="Close details" onClick={closeRecord}>×</button>
        <span className="inv-eyebrow">PRODUCT RECORD DETAILS</span>
        <h3 id="inv-dialog-title">{selectedRecord.productName||'Unnamed record'}</h3>
        <p className="inv-dialog-sub">Use this record's ID to distinguish products with identical SKUs. Changing a SKU does not automatically reconcile existing duplicates.</p>
        <dl className="inv-detail-grid">
          <div><dt>SKU</dt><dd>{selectedRecord.sku||'Unknown'}</dd></div>
          <div><dt>Record identity</dt><dd>{selectedRecord.productId?safeRecordLabel(selectedRecord):'Unavailable'}</dd></div>
          <div><dt>Category</dt><dd>{selectedRecord.category||'Missing'}</dd></div>
          <div><dt>Stored price</dt><dd>{selectedRecord.priceInvalid?String(selectedRecord.rawSalePrice??'Invalid'):money(selectedRecord.salePrice)}</dd></div>
          <div><dt>Stock status</dt><dd>{selectedRecord.stockReported===true?String(selectedRecord.quantityOnHand):'Unknown — check Inventory table'}</dd></div>
          <div><dt>Publication</dt><dd>{selectedRecord.publicationKnown===false?'Unknown (legacy record)':selectedRecord.published?'Published':'Not published'}</dd></div>
          <div><dt>Archive status</dt><dd>{selectedRecord.activeStatusKnown===false?'Unverified (legacy record)':isArchived(selectedRecord)?'Archived':'Active'}</dd></div>
          <div><dt>Created</dt><dd>{selectedRecord.createdAt||'Unknown'}</dd></div>
        </dl>
        <div className="inv-detail-issues"><strong>Data quality</strong>{selectedIssues.length===0?<p>No known issues in the current product API response.</p>:<div>{selectedIssues.map(issue=><span key={issue} className="inv-chip inv-chip-warn">{issueLabels[issue]}</span>)}</div>}</div>
        <StockControls key={selectedRecord.productId||selectedRecord.sku} product={selectedRecord} status={stockStatus} busy={busy||stockBusyId===selectedRecord.productId} allowInitialize={stockInitializeEnabled} allowAdjust={stockWritesEnabled} onInitialize={onStockInitialize} onAdjust={onStockAdjust} onRefresh={onReload}/>
        <div className="inv-dialog-actions">
          <button type="button" className="inv-button inv-button-light" onClick={closeRecord}>Close</button>
          <button type="button" className="inv-button inv-button-primary" disabled={busy||(!selectedRecord.productId&&isLegacy)} onClick={()=>{const record=selectedRecord;closeRecord();onEdit(record);}}>Edit this record</button>
          {!isLegacy && (isArchived(selectedRecord)?
            <button type="button" className="inv-button inv-button-outline" disabled={busy||summary.duplicateSkus>0&&((counts.get(String(selectedRecord.sku).toLowerCase())||0)>1)} onClick={()=>{const record=selectedRecord;closeRecord();onRestore(record);}}>Restore SKU</button>:
            <button type="button" className="inv-button inv-button-outline" disabled={busy||((counts.get(String(selectedRecord.sku).toLowerCase())||0)>1)} onClick={()=>{const record=selectedRecord;closeRecord();onArchive(record);}}>Archive SKU</button>)}
        </div>
        {isLegacy&&<div className="inv-legacy-delete">
          <strong>Remove this old AWS record</strong>
          <p>The existing API uses <code>DELETE /products/&#123;productId&#125;</code>. This may permanently erase the selected record, not archive it. Stock or purchase-order references might still exist. Deleting one <b>{selectedRecord.sku||'unnamed SKU'}</b> record will not remove the other products sharing that SKU.</p>
          <label className="inv-delete-confirm">
            <input type="checkbox" checked={deletionAcknowledged} onChange={e=>setDeletionAcknowledged(e.target.checked)} disabled={busy||!selectedRecord.productId}/>
            <span>I have verified a recoverable AWS backup and checked this record's inventory and purchase-order references. I understand deletion may be permanent.</span>
          </label>
          <button type="button" className="inv-delete-button" disabled={!selectedRecord.productId||!deletionAcknowledged||busy} onClick={requestLegacyRemoval}>
            Delete only this product record
          </button>
          <small>A second confirmation asks you to type DELETE. No record is removed without both approvals.</small>
        </div>}
      </section>
    </div>}
  </section>;
}
