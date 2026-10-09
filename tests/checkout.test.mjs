import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCart,dollarsToCents,validatedShopItem,orderTotal,sessionLineItems,validateShipping,requireProductionSafety,classifyStripeEvent} from '../backend/checkout-logic.mjs';
test('cart rejects duplicate sku, fractional and oversized quantity',()=>{
 assert.deepEqual(validateCart([{sku:'MTG-1',qty:2}]),[{sku:'MTG-1',qty:2}]);
 assert.throws(()=>validateCart([{sku:'MTG-1',qty:1},{sku:'MTG-1',qty:1}]),/Duplicate/);
 assert.throws(()=>validateCart([{sku:'MTG-1',qty:0.5}]),/Quantity/);
 assert.throws(()=>validateCart([{sku:'MTG-1',qty:21}]),/Quantity/);
});
test('server prices and published stock determine charged cents',()=>{
 const product={sku:'MTG-1',productName:'Black Lotus',salePrice:25.35,quantityOnHand:3,published:true};
 const item=validatedShopItem(product,{sku:'MTG-1',qty:2});
 assert.equal(item.unitAmount,2535);assert.equal(orderTotal([item]),5070);
 assert.equal(sessionLineItems([item])[0].price_data.unit_amount,2535);
 assert.throws(()=>validatedShopItem({...product,published:false},{sku:'MTG-1',qty:1}),/unavailable/);
 assert.throws(()=>validatedShopItem({...product,quantityOnHand:1},{sku:'MTG-1',qty:2}),/stock/);
 assert.throws(()=>dollarsToCents(1.234),/price/);
});
test('legacy checkout remains disabled regardless of test-mode Stripe config',()=>{
 assert.equal(validateShipping('0'),0);assert.throws(()=>validateShipping(undefined),/not configured/);
 const config={HOBBYHUB_PRODUCTS_PK_NAME:'sku',HOBBYHUB_INVENTORY_WRITES_ENABLED:'true',HOBBYHUB_CHECKOUT_ENABLED:'true',HOBBYHUB_STRIPE_TEST_ONLY:'true',STRIPE_SECRET_KEY:'sk_test_sample',STRIPE_WEBHOOK_SECRET:'whsec_sample',HOBBYHUB_ORDERS_TABLE:'orders',HOBBYHUB_PRODUCTS_TABLE:'products',HOBBYHUB_CHECKOUT_RETURN_ORIGIN:'https://preview.example.com',HOBBYHUB_SHIPPING_CENTS:'500',HOBBYHUB_ENABLE_AUTOMATIC_TAX:'true'};
 assert.throws(()=>requireProductionSafety(config),/disabled/);
 assert.throws(()=>requireProductionSafety({...config,STRIPE_SECRET_KEY:'sk_live_danger'}),/disabled/);
 assert.throws(()=>requireProductionSafety({...config,HOBBYHUB_ENABLE_AUTOMATIC_TAX:'false'}),/disabled/);
});
test('signed Stripe checkout event classifications never interpret unpaid completion as fulfillment',()=>{
 const base={data:{object:{object:'checkout.session',payment_status:'unpaid'}}};
 assert.equal(classifyStripeEvent({...base,type:'checkout.session.completed'}),'ignore');
 assert.equal(classifyStripeEvent({...base,type:'checkout.session.completed',data:{object:{...base.data.object,payment_status:'paid'}}}),'paid');
 assert.equal(classifyStripeEvent({...base,type:'checkout.session.expired'}),'release');
});
