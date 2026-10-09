import React,{useMemo,useState} from 'react';
import {centsUsd,orderStats,selectOrders} from '../lib/orderOps.js';
import './order-workbench.css';

const STATUS_TEXT={
  PAID:'Paid',PENDING:'Payment pending',REFUND_PENDING:'Refund pending',REFUNDED:'Refunded',
  DISPUTED:'Disputed',UNFULFILLED:'Not fulfilled',PICKING:'Picking',PACKED:'Packed',
  SHIPPED:'Shipped',DELIVERED:'Delivered',CANCELLED:'Cancelled',UNKNOWN:'Needs verification'
};
const LAUNCH_ITEMS=[
  'Verify customer payment event handling and duplicate-webhook safety',
  'Link order reservations to versioned Stock V2 balances',
  'Set domestic shipping rates, carriers, package sizes and cutoff times',
  'Document returns, cancellations and damaged-item handling',
  'Rehearse paid → packed → shipped flow in the isolated test environment',
  'Review contact, legal and tax settings before accepting money'
];
export default function OrderWorkbench({orders=[],status='unconfigured',notice='',onReload=()=>{},busy=false}) {
  const [filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[sort,setSort]=useState('newest');
  const [selected,setSelected]=useState(null);
  const totals=useMemo(()=>orderStats(orders),[orders]);
  const filtered=useMemo(()=>selectOrders(orders,{query,status:filter,sort}),[orders,query,filter,sort]);
  const current=orders.find(o=>o.orderId===selected);
  const connected=status==='ready';
  return <section className="hh-orders" aria-labelledby="hh-orders-title">
    <header className="hh-orders-header">
      <div><span className="hh-orders-eyebrow">HOBBY HUB / SALES OPERATIONS</span>
        <h2 id="hh-orders-title">Order command center</h2>
        <p>Verified payment and fulfillment states, built separately from supplier purchase orders.</p>
      </div>
      <button type="button" className="hh-orders-refresh" onClick={onReload} disabled={busy||status==='unconfigured'}>↻ Refresh orders</button>
    </header>
    <div className="hh-orders-status" role="status">
      <strong>{status==='unconfigured'?'Customer orders are not connected yet':status==='loading'?'Loading verified customer orders…':status==='unavailable'?'Order service cannot be verified':'Order read-only connection established'}</strong>
      <p>{status==='unconfigured'?'This interface is prepared, but no customer-order API or Stripe checkout has been deployed. No customer orders are being created.':status==='unavailable'?'Existing products and inventory are unaffected; no guessed order information will be displayed.':status==='loading'?'Waiting for the authenticated order service.':'This panel is read-only. Payment and shipment actions are disabled until stock reservations, Stripe events and shipping are verified.'}</p>
    </div>
    {notice&&<p role="alert" className="hh-orders-message">{notice}</p>}
    <div className="hh-orders-metrics">
      <div><span>Verified orders</span><strong>{connected?totals.total:'—'}</strong></div>
      <div><span>Paid · to pack</span><strong>{connected?totals.awaitingFulfillment:'—'}</strong></div>
      <div><span>In progress</span><strong>{connected?totals.inProgress:'—'}</strong></div>
      <div><span>Needs attention</span><strong>{connected?totals.requiresAttention:'—'}</strong></div>
    </div>
    <div className="hh-orders-body">
      <div className="hh-orders-main">
        <div className="hh-orders-controls">
          <label>Search orders<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Order ID, SKU, or item name"/></label>
          <label>Status<select value={filter} onChange={e=>setFilter(e.target.value)}>
            <option value="all">All orders</option><option value="to-ship">Paid / not fulfilled</option>
            <option value="in-progress">Picking, packed, shipped</option>
            <option value="attention">Needs attention</option>
            <option value="delivered">Delivered</option><option value="refunded">Refunded</option>
          </select></label>
          <label>Sort<select value={sort} onChange={e=>setSort(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
        </div>
        {!connected?<div className="hh-orders-empty">
          <span aria-hidden="true">◇</span><strong>Orders are not available yet</strong>
          <p>We'll connect this panel after the dedicated order table, Stripe webhook tests, and Stock V2 reservations are ready. No orders or payment records are simulated.</p>
        </div>:filtered.length===0?<div className="hh-orders-empty"><strong>{orders.length?'No orders match the filters':'No verified customer orders yet'}</strong><p>Only records returned by the authenticated customer order service appear here.</p></div>:
          <div className="hh-orders-table-scroll"><table className="hh-orders-table"><thead><tr><th>ORDER</th><th>PAYMENT</th><th>FULFILLMENT</th><th>ITEMS</th><th>TOTAL</th><th/></tr></thead>
            <tbody>{filtered.map(o=><tr key={o.orderId}><td><strong>{o.orderId.slice(0,12)}{o.orderId.length>12?'…':''}</strong><small>{o.createdAt?new Date(o.createdAt).toLocaleDateString():'Date unavailable'}</small></td>
              <td><span className={'hh-orders-state '+(o.paymentStatus==='PAID'?'is-paid':'')}>{STATUS_TEXT[o.paymentStatus]}</span></td>
              <td><span className="hh-orders-state">{STATUS_TEXT[o.fulfillmentStatus]}</span></td>
              <td>{o.itemCount}</td><td>{centsUsd(o.totalCents)}</td>
              <td><button type="button" className="hh-orders-review" onClick={()=>setSelected(o.orderId)}>View</button></td></tr>)}</tbody></table></div>}
      </div>
      <aside className="hh-orders-sidebar">
        <h3>Launch checklist</h3>
        <p>These are required preparations, not completed business or payment approvals.</p>
        <ul>{LAUNCH_ITEMS.map(item=><li key={item}>{item}</li>)}</ul>
        <p className="hh-orders-readonly">Checkout remains off. This dashboard cannot charge cards, change shipments, issue refunds or reserve stock.</p>
      </aside>
    </div>
    {current&&<div className="hh-order-modal-bg" role="presentation" onClick={()=>setSelected(null)}>
      <section className="hh-order-modal" role="dialog" aria-modal="true" aria-label={'Order '+current.orderId} onClick={e=>e.stopPropagation()}>
        <button type="button" className="hh-order-close" onClick={()=>setSelected(null)} aria-label="Close order">×</button>
        <span className="hh-orders-eyebrow">VERIFIED ORDER RECORD</span><h3>Order {current.orderId}</h3>
        <p>Payment: {STATUS_TEXT[current.paymentStatus]}. Fulfillment: {STATUS_TEXT[current.fulfillmentStatus]}.</p>
        <p>{current.createdAt?new Date(current.createdAt).toLocaleString():'No verified created date'} · {centsUsd(current.totalCents)}</p>
        <h4>Items</h4>
        {current.items.length?<ul>{current.items.map((x,i)=><li key={x.sku+'-'+i}>{x.qty} × {x.productName}{x.sku?' · '+x.sku:''}</li>)}</ul>:<p>No line item summary was returned.</p>}
        <p className="hh-orders-readonly">Read-only order view. No fulfillment actions are enabled.</p>
      </section>
    </div>}
  </section>;
}
