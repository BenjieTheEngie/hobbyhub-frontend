/**
 * Browser-only admin order view. Order states are read from AWS, never guessed
 * from cart contents, inventory balances or local browser storage.
 */
export const PAYMENT_STATES=Object.freeze(['PENDING','PAID','REFUND_PENDING','REFUNDED','DISPUTED']);
export const FULFILLMENT_STATES=Object.freeze(['UNFULFILLED','PICKING','PACKED','SHIPPED','DELIVERED','CANCELLED']);

const acceptedCurrency=new Set(['usd']);
function safeDate(s) {
  if(typeof s!=='string'||!Number.isFinite(Date.parse(s)))return null;
  return s;
}
function isPositiveQuantity(q){return Number.isSafeInteger(q)&&q>0&&q<=100000;}

export function normalizeOrderList(data) {
  const rows=Array.isArray(data)?data:data?.items;
  if(!Array.isArray(rows))throw Error('Order service returned an invalid order list.');
  const ids=new Set();
  return rows.map(raw=>{
    const orderId=raw?.orderId;
    if(typeof orderId!=='string'||orderId.length<3||orderId.length>128||ids.has(orderId))
      throw Error('Order service returned an invalid or duplicate order ID.');
    ids.add(orderId);
    const amount=raw.totalCents;
    const pendingCharge=amount===null && raw.paymentStatus==='PENDING' && raw.status==='RESERVED';
    if(!pendingCharge && (!Number.isSafeInteger(amount)||amount<0||amount>1000000000))
      throw Error('Order service returned an invalid amount.');
    if(!acceptedCurrency.has(String(raw.currency||'usd').toLowerCase()))
      throw Error('Order service returned an unsupported currency.');
    const items=Array.isArray(raw.items)?raw.items.map(x=>{
      const qty=x.qty??x.quantity;
      if(!isPositiveQuantity(qty))throw Error('Order service returned an invalid order quantity.');
      return {productName:String(x.productName||'Product'),sku:String(x.sku||''),qty};
    }):[];
    if(items.length>100)throw Error('Order service returned too many line items.');
    return {
      orderId,paymentStatus:PAYMENT_STATES.includes(raw.paymentStatus)?raw.paymentStatus:'UNKNOWN',
      fulfillmentStatus:FULFILLMENT_STATES.includes(raw.fulfillmentStatus)?raw.fulfillmentStatus:'UNKNOWN',
      totalCents:amount,currency:'usd',createdAt:safeDate(raw.createdAt),
      updatedAt:safeDate(raw.updatedAt),items,
      itemCount:items.reduce((n,x)=>n+x.qty,0),
    };
  });
}
export function orderStats(orders) {
  return {
    total:orders.length,
    awaitingPayment:orders.filter(o=>o.paymentStatus==='PENDING').length,
    awaitingFulfillment:orders.filter(o=>o.paymentStatus==='PAID'&&o.fulfillmentStatus==='UNFULFILLED').length,
    inProgress:orders.filter(o=>['PICKING','PACKED','SHIPPED'].includes(o.fulfillmentStatus)).length,
    completed:orders.filter(o=>o.fulfillmentStatus==='DELIVERED').length,
    requiresAttention:orders.filter(o=>o.paymentStatus==='DISPUTED'||o.paymentStatus==='UNKNOWN'||o.fulfillmentStatus==='UNKNOWN').length,
  };
}
export function selectOrders(orders,{query='',status='all',sort='newest'}={}) {
  const q=query.trim().toLocaleLowerCase();
  const filtered=orders.filter(o=>
    (status==='all'||(status==='to-ship'&&o.paymentStatus==='PAID'&&o.fulfillmentStatus==='UNFULFILLED')||
      (status==='in-progress'&&['PICKING','PACKED','SHIPPED'].includes(o.fulfillmentStatus))||
      (status==='attention'&&['UNKNOWN','DISPUTED'].includes(o.paymentStatus)||status==='attention'&&o.fulfillmentStatus==='UNKNOWN')||
      (status===o.paymentStatus.toLowerCase())||
      (status===o.fulfillmentStatus.toLowerCase())
    )&&
    (!q || [o.orderId,...o.items.flatMap(x=>[x.sku,x.productName])].some(x=>String(x).toLocaleLowerCase().includes(q)))
  );
  return [...filtered].sort((a,b)=>sort==='oldest'?
    String(a.createdAt||'').localeCompare(String(b.createdAt||'')) :
    String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
}
export function centsUsd(amount) {
  if(!Number.isSafeInteger(amount)||amount<0)return 'Amount unavailable';
  return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(amount/100);
}
export async function loadOrderOps(base,token) {
  if(typeof base!=='string'||!/^https:\/\//i.test(base))throw Error('Order operations API is not configured.');
  if(!token)throw Error('Admin authentication is required.');
  const res=await fetch(base.replace(/\/$/,'')+'/ops/orders',{
    headers:{Authorization:'Bearer '+token},cache:'no-store'
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.message||'Could not load verified orders.');
  return normalizeOrderList(data);
}
