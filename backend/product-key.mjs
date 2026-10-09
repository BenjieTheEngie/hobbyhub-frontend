/**
 * DynamoDB inventory key helpers. Pure functions so tests do not require AWS credentials.
 *
 * A SKU is a business identifier. On legacy Hobby Hub the primary key is productId.
 * Never issue a mutation until a unique SKU resolves to the actual DynamoDB partition key.
 */
export const SUPPORTED_PRODUCT_KEYS = Object.freeze(['sku', 'productId']);

export function tableKeyName(env = process.env) {
  const name = env.HOBBYHUB_PRODUCTS_PK_NAME;
  return SUPPORTED_PRODUCT_KEYS.includes(name) ? name : null;
}

export function assessSkuMatch(items, sku, keyName) {
  if (!SUPPORTED_PRODUCT_KEYS.includes(keyName)) return {status:'schema_error'};
  if (!Array.isArray(items)) return {status:'lookup_error'};
  const found = items.filter(x => x && x.sku === sku &&
    typeof x[keyName] === 'string' && x[keyName].length > 0);
  if (found.length > 1) return {status:'ambiguous'};
  if (!found.length) return {status:'not_found'};
  return {status:'found', key:{[keyName]: found[0][keyName]}};
}

export function updateCondition(keyName, existing) {
  if (!SUPPORTED_PRODUCT_KEYS.includes(keyName)) throw new Error('Unsupported DynamoDB key schema.');
  // Quantity is compared exactly as DynamoDB stores it, avoiding unexpected
  // type conversions on legacy records that predate inventory reservations.
  const names = {'#pk':keyName,'#sku':'sku','#stock':'quantityOnHand'};
  const values = {':expectedSku':existing.sku};
  let condition = 'attribute_exists(#pk) AND #sku = :expectedSku';
  if (Object.prototype.hasOwnProperty.call(existing,'quantityOnHand')) {
    condition += ' AND #stock = :previousStock';
    values[':previousStock'] = existing.quantityOnHand;
  } else {
    condition += ' AND attribute_not_exists(#stock)';
  }
  return {condition,names,values};
}
