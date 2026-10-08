// Deploy-safe switches: absence, typos, or casing differences all mean disabled.
export function inventoryWritesEnabled(env = process.env) {
  return env.HOBBYHUB_INVENTORY_WRITES_ENABLED === 'true' && env.HOBBYHUB_PRODUCTS_PK_NAME === 'sku';
}
export function stripeCheckoutEnabled(env = process.env) {
  return inventoryWritesEnabled(env) && env.HOBBYHUB_CHECKOUT_ENABLED === 'true' && env.HOBBYHUB_STRIPE_TEST_ONLY === 'true';
}
