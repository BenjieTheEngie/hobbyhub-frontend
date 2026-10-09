// Deployment-safe switches. Missing, mistyped, or unreviewed settings stay OFF.
export function inventoryWritesEnabled(env = process.env) {
  if (env.HOBBYHUB_INVENTORY_WRITES_ENABLED !== 'true') return false;
  const key = env.HOBBYHUB_PRODUCTS_PK_NAME;
  if (key === 'sku') return true;
  // Legacy Hobby Hub uses productId as partition key, so this requires a
  // separate explicit acknowledgement after inspecting real records.
  return key === 'productId' && env.HOBBYHUB_PRODUCTID_SCHEMA_VERIFIED === 'true';
}

export function stripeCheckoutEnabled() {
  // The retired legacy checkout reads and mutates products using SKU as the
  // DynamoDB partition key. Hobby Hub's actual key is productId; its physical
  // stock is stored separately in Inventory. Environment flags alone cannot
  // make this integration safe even with a test-mode Stripe secret.
  // This function intentionally NEVER permits it to run. Build and stage a
  // separately audited Checkout V2 handler before considering payments.
  return false;
}
