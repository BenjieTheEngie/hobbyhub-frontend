import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOrderList,orderStats,selectOrders,centsUsd} from '../src/lib/orderOps.js';

const rows=[
  {orderId:'order-00001',createdAt:'2026-10-07T12:00:00Z',totalCents:1199,currency:'usd',
    paymentStatus:'PAID',fulfillmentStatus:'UNFULFILLED',
    items:[{productName:'Play Booster',sku:'MTG-001',qty:2}]},
  {orderId:'order-00002',createdAt:'2026-10-08T12:00:00Z',totalCents:3000,currency:'USD',
    paymentStatus:'PAID',fulfillmentStatus:'SHIPPED',
    items:[{productName:'Vintage game',sku:'GAME-1',qty:1}]},
  {orderId:'order-00003',createdAt:'2026-10-09T12:00:00Z',totalCents:400,
    paymentStatus:'DISPUTED',fulfillmentStatus:'UNFULFILLED',items:[]},
];
test('normalize verified order summaries and omit private shipping/customer fields',()=>{
  const orders=normalizeOrderList({items:[{...rows[0],customerEmail:'private@example.com',shippingAddress:{street:'private'}}]});
  assert.equal(orders[0].itemCount,2);
  assert.equal(orders[0].totalCents,1199);
  assert.equal(orders[0].paymentStatus,'PAID');
  assert.equal('customerEmail' in orders[0],false);
  assert.equal('shippingAddress' in orders[0],false);
});
test('reject malformed, conflicting and unsupported order list data',()=>{
  assert.throws(()=>normalizeOrderList({items:5}),/invalid order list/);
  assert.throws(()=>normalizeOrderList({items:[rows[0],rows[0]]}),/duplicate order ID/);
  assert.throws(()=>normalizeOrderList({items:[{...rows[0],totalCents:1.5}]}),/invalid amount/);
  assert.throws(()=>normalizeOrderList({items:[{...rows[0],totalCents:-1}]}),/invalid amount/);
  assert.throws(()=>normalizeOrderList({items:[{...rows[0],currency:'btc'}]}),/unsupported currency/);
  assert.throws(()=>normalizeOrderList({items:[{...rows[0],items:[{sku:'X',qty:0}]}]}),/invalid order quantity/);
});
test('unknown payment or fulfillment state stays unverified, not fake success',()=>{
  const orders=normalizeOrderList({items:[{...rows[0],paymentStatus:'COMPLETE',fulfillmentStatus:'DELIVERED_TO_MOON'}]});
  assert.equal(orders[0].paymentStatus,'UNKNOWN');
  assert.equal(orders[0].fulfillmentStatus,'UNKNOWN');
  assert.equal(orderStats(orders).requiresAttention,1);
});
test('order dashboard totals only confirmed paid/unfulfilled and fulfillment states',()=>{
  const orders=normalizeOrderList({items:rows});
  assert.deepEqual(orderStats(orders),{
    total:3,awaitingPayment:0,awaitingFulfillment:1,inProgress:1,completed:0,requiresAttention:1
  });
  assert.deepEqual(selectOrders(orders,{status:'to-ship'}).map(o=>o.orderId),['order-00001']);
  assert.deepEqual(selectOrders(orders,{status:'in-progress'}).map(o=>o.orderId),['order-00002']);
  assert.deepEqual(selectOrders(orders,{status:'attention'}).map(o=>o.orderId),['order-00003']);
});
test('sort/search and order selection do not mutate the source list',()=>{
  const orders=normalizeOrderList({items:rows});
  const before=JSON.stringify(orders);
  assert.deepEqual(selectOrders(orders,{sort:'oldest'}).map(o=>o.orderId),['order-00001','order-00002','order-00003']);
  assert.deepEqual(selectOrders(orders,{query:'GAME-1'}).map(o=>o.orderId),['order-00002']);
  assert.equal(JSON.stringify(orders),before);
});
test('order totals remain integer cents, never client-calculated checkout charges',()=>{
  assert.equal(centsUsd(1199),'$11.99');
  assert.equal(centsUsd(-5),'Amount unavailable');
});
