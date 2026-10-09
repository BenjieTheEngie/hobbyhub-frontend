// Deployment-safe switches. Missing, mistyped, or unreviewed settings stay OFF.
export function inventoryWritesEnabled(env = process.env) {
  if (env.HOBBYHUB_INVENTORY_WRITES_ENABLED !== 'true') return false;
  const key = env.HOBBYHUB_PRODUCTS_PK_NAME;
  if (key === 'sku') return true;
  // Legacy Hobby Hub uses productId as partition key, so this requires a
  // separate explicit acknowledgement after inspecting real records.
  return key === 'productId' && env.HOBBYHUB_PRODUCTID_SCHEMA_VERIFIED === 'true';
}

export function stripeCheckoutEnabled(env = process.env) {
  // Checkout reservation and release logic still uses the SKU primary key.
  // NEVER enable payment handling against the legacy productId schema.
  return env.HOBBYHUB_PRODUCTS_PK_NAME === 'sku' &&
    inventoryWritesEnabled(env) &&
    env.HOBBYHUB_CHECKOUT_ENABLED === 'true' &&
    env.HOBBYHUB_STRIPE_TEST_ONLY === 'true';
}
