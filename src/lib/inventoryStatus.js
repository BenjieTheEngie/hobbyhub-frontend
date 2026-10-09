/**
 * Keep archived inventory separate from active SKUs.
 * The AWS DELETE endpoint soft-archives products (isactive=false), preserving history.
 */
export function isArchived(product) {
  return product?.isactive === false || product?.isActive === false;
}

export function normalizeInventoryResponse(response) {
  const raw = Array.isArray(response) ? response : response?.items;
  if (!Array.isArray(raw)) throw new Error('The inventory API returned an invalid products list.');
  return raw.filter(p => p && typeof p === 'object').map(p => ({
    ...p,
    sku: String(p.sku ?? '').trim(),
    productName: String(p.productName ?? p.name ?? '').trim(),
    category: String(p.category || 'Accessories'),
    salePrice: Math.max(0, Number(p.salePrice) || 0),
    quantityOnHand: Math.max(0, Math.trunc(Number(p.quantityOnHand) || 0)),
    stockReported: p.quantityOnHand !== null && p.quantityOnHand !== undefined && Number.isFinite(Number(p.quantityOnHand)),
    priceInvalid: !Number.isFinite(Number(p.salePrice)) || Number(p.salePrice) < 0,
    imageUrl: String(p.imageUrl || ''),
    published: p.published === true,
    isactive: !isArchived(p),
  })).filter(p => p.sku);
}

export function inventoryForView(products, showArchived = false) {
  return products.filter(p => isArchived(p) === showArchived);
}

export function archiveConfirmed(reply, sku, refreshed = null) {
  if (reply?.archived === sku) return true;
  if (!Array.isArray(refreshed)) return false;
  return !refreshed.some(p => p.sku === sku && !isArchived(p));
}
