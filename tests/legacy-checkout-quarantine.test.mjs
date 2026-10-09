import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripeCheckoutEnabled,inventoryWritesEnabled} from '../backend/guard.mjs';

const source=readFileSync(new URL('../backend/checkout.mjs',import.meta.url),'utf8');
const template=readFileSync(new URL('../aws/media-addon/template.yaml',import.meta.url),'utf8');

test('unsafe legacy Stripe checkout cannot be enabled by any historic config switches',()=>{
  const base={
    HOBBYHUB_PRODUCTS_PK_NAME:'sku',
    HOBBYHUB_INVENTORY_WRITES_ENABLED:'true',
    HOBBYHUB_PRODUCTID_SCHEMA_VERIFIED:'true',
    HOBBYHUB_CHECKOUT_ENABLED:'true',
    HOBBYHUB_STRIPE_TEST_ONLY:'true'
  };
  for(const key of ['sku','productId',undefined]){
    for(const testOnly of ['true','false']){
      const env={...base,HOBBYHUB_PRODUCTS_PK_NAME:key,HOBBYHUB_STRIPE_TEST_ONLY:testOnly};
      assert.equal(stripeCheckoutEnabled(env),false);
    }
  }
  assert.equal(stripeCheckoutEnabled({}),false);
  // Preserve the separate legacy productId CRUD opt-in independently of payment.
  assert.equal(inventoryWritesEnabled({...base,HOBBYHUB_PRODUCTS_PK_NAME:'productId'}),true);
});

test('checkout and webhook endpoints reject before any Stripe or DynamoDB I/O',()=>{
  assert.match(source,/import \{stripeCheckoutEnabled\} from '\.\/guard\.mjs'/);
  for(const handler of ['beginCheckoutHandler','stripeWebhookHandler','statusHandler','reconcileHandler']){
    const at=source.indexOf('export async function '+handler+'(');
    assert.ok(at>=0,handler+' must exist');
    const end=source.indexOf('\nexport async function ',at+1);
    const section=source.slice(at,end<0?undefined:end);
    const gate=section.indexOf('if(!stripeCheckoutEnabled())');
    const firstTry=section.indexOf('try{');
    assert.ok(gate>=0,handler+' must refuse legacy checkout');
    if(firstTry>=0)assert.ok(gate<firstTry,handler+' must refuse before remote I/O');
  }
  assert.match(source,/if\(method==='POST'\)return reply\(503,\{message:'Legacy order fulfillment is disabled\.'\}\)/);
});

test('obsolete SAM add-on cannot create legacy payments merely from supplying Stripe secrets',()=>{
  assert.match(template,/EnableLegacyCheckoutInfrastructure:\s*\n\s*Type: String\s*\n\s*AllowedValues: \['false'\]\s*\n\s*Default: 'false'/);
  const section=template.split('  HasStripeSecrets: !And')[1]?.split('\n  CheckoutEnabled:')[0]||'';
  assert.match(section,/!Equals \[!Ref EnableLegacyCheckoutInfrastructure, 'true'\]/);
  assert.match(section,/!Ref StripeTestSecretArn/);
  assert.match(section,/!Ref StripeWebhookSecretArn/);
  for(const name of ['CheckoutFunction','CheckoutWebhookFunction','OrderReconcileFunction','OrdersAdminFunction']){
    assert.match(template,new RegExp('  '+name+':\\n    Condition: HasStripeSecrets'));
  }
});
