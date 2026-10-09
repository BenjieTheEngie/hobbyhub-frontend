import React,{useState} from 'react';
import {canEditStock,ensureAdjustedStockAvailable} from '../lib/stockV2Client.js';

const ADJUST_REASONS=[
  ['restock','New stock / restock'],
  ['cycle-count','Physical count correction'],
  ['customer-return','Returned item'],
  ['damage','Damaged / lost inventory'],
  ['correction','Manual correction'],
  ['other','Other adjustment'],
];
export default function StockControls({product,status='unconfigured',busy=false,allowInitialize=false,allowAdjust=false,onInitialize,onAdjust,onRefresh}) {
  const [amount,setAmount]=useState('1');
  const [direction,setDirection]=useState('add');
  const [reason,setReason]=useState('restock');
  const [note,setNote]=useState('');
  const [initial,setInitial]=useState('0');
  const [reorder,setReorder]=useState('2');
  const [notice,setNotice]=useState('');
  const hasStock=canEditStock(product,status);
  const initialized=product?.stockReported===true && product.stockSource==='stock-v2';
  async function submitAdjustment(e){
    e.preventDefault();setNotice('');
    try {
      if(!allowAdjust)throw Error('Stock writes have not been enabled for this deployment.');
      if(!hasStock)throw Error('Stock record is not ready. Refresh your inventory.');
      const absolute=Number(amount);
      if(!Number.isSafeInteger(absolute)||absolute<1)throw Error('Enter a positive whole number of units.');
      const delta=(direction==='remove'?-1:1)*absolute;
      const next=ensureAdjustedStockAvailable(product,delta);
      if(!window.confirm('Update the exact AWS stock record for '+product.sku+' ('+product.productId+') from '+product.quantityOnHand+' to '+next+'?'))return;
      await onAdjust(product,{delta,reason,note});
      setNotice('Stock update confirmed in AWS. Refreshed quantity: '+next);
    }catch(e){setNotice('Stock not confirmed: '+e.message+' Refresh the balance before attempting again.');}
  }
  async function submitInitialize(e){
    e.preventDefault();setNotice('');
    try {
      if(!allowInitialize||status!=='ready'||!product?.productId)throw Error('Opening stock balances is disabled until migration verification.');
      const onHand=Number(initial),reorderPoint=Number(reorder);
      if(!Number.isSafeInteger(onHand)||onHand<0||onHand>10000000 ||
        !Number.isSafeInteger(reorderPoint)||reorderPoint<0||reorderPoint>10000000)throw Error('Initial balances and reorder points must be nonnegative whole numbers.');
      if(!window.confirm('Initialize NEW stock for '+product.productName+' / '+product.productId+' with '+onHand+' units? Do this only after reviewing the legacy Inventory table; it does not import legacy balances.'))return;
      await onInitialize(product,{onHand,reorderPoint,reason:'initial-count',note});
      setNotice('Opening balance verified in AWS.');
    }catch(e){setNotice('Opening balance not confirmed: '+e.message+' Refresh before retrying.');}
  }
  return <section className="hh-stock-controls" aria-label="Stock management">
    <div className="hh-stock-heading"><strong>Warehouse stock</strong><button type="button" className="inv-button inv-button-light" onClick={onRefresh} disabled={busy||status==='unconfigured'}>↻ Refresh</button></div>
    {status==='unconfigured'&&<p>Stock service is not deployed or connected. Your working product management remains available, but quantities cannot be edited safely yet.</p>}
    {status==='loading'&&<p>Loading verified warehouse balances…</p>}
    {status==='unavailable'&&<p role="alert">Stock verification is unavailable. No changes can be submitted.</p>}
    {status==='ready'&& !initialized && <div className="hh-stock-unknown">
      <strong>No verified stock balance for this productId</strong>
      <p>This does not mean stock is zero. Check the legacy Inventory table before opening a new balance.</p>
      {allowInitialize&&<form onSubmit={submitInitialize}>
        <label>Opening quantity<input type="number" min="0" step="1" value={initial} onChange={e=>setInitial(e.target.value)}/></label>
        <label>Reorder point<input type="number" min="0" step="1" value={reorder} onChange={e=>setReorder(e.target.value)}/></label>
        <label>Count notes<input value={note} maxLength={160} onChange={e=>setNote(e.target.value)} placeholder="Verified stock count reference"/></label>
        <button type="submit" className="inv-button inv-button-primary" disabled={busy||!allowInitialize}>Initialize verified balance</button>
      </form>}
    </div>}
    {hasStock&&<form onSubmit={submitAdjustment}>
      {!allowAdjust&&<p role="status">Stock is available to view; adjustments remain locked until backend verification and approval.</p>}
      <div className="hh-stock-balance"><span>On hand</span><strong>{product.quantityOnHand}</strong><small>Reserved: {product.stockReserved} · Available: {product.stockAvailable} · Version {product.stockVersion} · Reorder at {product.reorderPoint}</small></div>
      <div className="hh-stock-inputs">
        <label>Action<select value={direction} onChange={e=>{setDirection(e.target.value);setReason(e.target.value==='remove'?'correction':'restock');}}><option value="add">Add stock</option><option value="remove">Remove stock</option></select></label>
        <label>Units<input type="number" min="1" max="100000" step="1" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        <label>Reason<select value={reason} onChange={e=>setReason(e.target.value)}>{ADJUST_REASONS.map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
      </div>
      <label>Adjustment notes (optional)<input value={note} maxLength={160} onChange={e=>setNote(e.target.value)} placeholder="Invoice or stocktake reference"/></label>
      <button type="submit" className="inv-button inv-button-primary" disabled={busy||!allowAdjust}>Confirm stock adjustment</button>
    </form>}
    {notice&&<p className="inv-feedback" role="status">{notice}</p>}
  </section>;
}
