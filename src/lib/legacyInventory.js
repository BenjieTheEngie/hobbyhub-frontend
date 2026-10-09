/**
 * Existing AWS API (API Gateway 13bdy276e1) uses:
 *   DELETE/PUT /products/{productId}
 * while the future add-on uses:
 *   DELETE/PUT /products/{sku} (soft archive).
 * Never treat the identifiers or their deletion semantics as interchangeable.
 */
export function productIdentity(product, legacy = true) {
  if (!product || typeof product !== 'object') return null;
  const field = legacy ? 'productId' : 'sku';
  const id = product[field];
  return typeof id === 'string' && id.trim() ? {field,id:id.trim()} : null;
}

export function productRoute(product, legacy = true) {
  const identity = productIdentity(product, legacy);
  return identity ? '/products/' + encodeURIComponent(identity.id) : null;
}

export function countSkuMatches(products, sku) {
  return products.filter(p => p?.sku === sku).length;
}

export function recordChangedOrRemoved(original, latest, legacy = true, expectArchive = false) {
  if (!Array.isArray(latest)) return false;
  const identity=productIdentity(original,legacy);
  if(!identity)return false;
  // A legacy GET response which strips productId cannot prove a specific
  // record disappeared. Refuse to report success in that case.
  if(legacy && latest.length>0 && latest.some(p=>!productIdentity(p,true)))return false;
  const record=latest.find(p=>p?.[identity.field]===identity.id);
  if(!record) return true; // Permanent deletion verified by read-after-write.
  if(!expectArchive)return false; // Legacy DELETE is not assumed to archive.
  return record.isactive===false || record.isActive===false;
}

export function inventoryStockKnown(product) {
  return product && typeof product.quantityOnHand !== 'undefined' &&
    product.quantityOnHand !== null && Number.isFinite(Number(product.quantityOnHand));
}

export function safeRecordLabel(product) {
  const id=String(product?.productId||'');
  // A short suffix distinguishes records without showing full identifiers.
  return id ? '…'+id.slice(-6) : 'ID unavailable';
}
