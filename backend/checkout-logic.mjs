// Stateless validation; payment totals always come from server-side DynamoDB records.
import {stripeCheckoutEnabled} from './guard.mjs';
export const MAX_CART_LINES = 20;
export const MAX_CART_QTY = 20;
export const ORDER_HOLD_SECONDS = 35 * 60;
export function validateCart(input) {
  if(!Array.isArray(input) || !input.length || input.length > MAX_CART_LINES)throw new Error('Cart must contain 1–20 different products.');
  const seen=new Set();
  return input.map(line=>{
    const sku=String(line?.sku||'').trim();
    const qty=Number(line?.qty);
    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(sku))throw new Error('Cart contains an invalid SKU.');
    if(!Number.isSafeInteger(qty)||qty<1||qty>MAX_CART_QTY)throw new Error('Quantity must be between 1 and 20.');
    if(seen.has(sku))throw new Error('Duplicate SKU in cart.');
    seen.add(sku);return {sku,qty};
  });
}
export function dollarsToCents(value) {
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||n>100000 || Math.round(n*100)/100!==n)throw new Error('Invalid server-side product price.');
  return Math.round(n*100);
}
export function validatedShopItem(record,cartLine){
  if(!record || record.published!==true || record.isactive===false || record.isActive===false) throw new Error(`Item ${cartLine.sku} is unavailable.`);
  if(record.sku!==cartLine.sku || typeof record.productName!=='string' || !record.productName.trim())throw new Error('Product data changed. Refresh your cart.');
  if(!Number.isSafeInteger(Number(record.quantityOnHand)) || Number(record.quantityOnHand)<cartLine.qty)throw new Error(`Insufficient stock for ${cartLine.sku}.`);
  const cents=dollarsToCents(record.salePrice);
  if(cents<50)throw new Error('Stripe card checkout currently requires products priced at $0.50 or more.');
  return {sku:record.sku,name:record.productName.trim().slice(0,200),qty:cartLine.qty,unitAmount:cents,unitPrice:Number(record.salePrice)};
}
export function orderTotal(items){const total=items.reduce((sum,item)=>sum+item.unitAmount*item.qty,0);if(!Number.isSafeInteger(total)||total<50 || total>25000000)throw new Error('Order total exceeds checkout limits.');return total;}
export function sessionLineItems(items){return items.map(x=>({price_data:{currency:'usd',product_data:{name:x.name,metadata:{sku:x.sku}},unit_amount:x.unitAmount},quantity:x.qty}));}
export function validateShipping(input){
  if(input===undefined || input===null || !/^\d+$/.test(String(input)))throw new Error('Shipping policy is not configured.');
  const cents=Number(input);if(!Number.isSafeInteger(cents)||cents<0||cents>50000)throw new Error('Invalid shipping amount.');
  return cents;
}
export function requireProductionSafety(env) {
 if(!stripeCheckoutEnabled(env))throw new Error('Checkout is disabled until the inventory schema, write access and sandbox have been approved.');
 if(env.HOBBYHUB_STRIPE_TEST_ONLY!=='true')throw new Error('Only Stripe test mode is allowed until explicitly approved for live processing.');
 if(!String(env.STRIPE_SECRET_KEY||'').startsWith('sk_test_'))throw new Error('Stripe sandbox secret key is required.');
 if(!env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'))throw new Error('Stripe webhook signature secret is required.');
 if(!env.HOBBYHUB_ORDERS_TABLE||!env.HOBBYHUB_PRODUCTS_TABLE)throw new Error('Approved DynamoDB tables are required.');
 if(!/^https:\/\//.test(env.HOBBYHUB_CHECKOUT_RETURN_ORIGIN||''))throw new Error('HTTPS return origin is required.');
 if(env.HOBBYHUB_ENABLE_AUTOMATIC_TAX!=='true')throw new Error('Stripe automatic tax must be configured and activated.');
 validateShipping(env.HOBBYHUB_SHIPPING_CENTS);
}
export function classifyStripeEvent(event){
 const obj=event?.data?.object;
 if(obj?.object!=='checkout.session')return 'ignore';
 if(event.type==='checkout.session.completed' && obj.payment_status==='paid')return 'paid';
 if(event.type==='checkout.session.async_payment_succeeded')return 'paid';
 if(event.type==='checkout.session.expired' || event.type==='checkout.session.async_payment_failed')return 'release';
 return 'ignore';
}
