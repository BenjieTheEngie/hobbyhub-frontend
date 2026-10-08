export const DEFAULT_CATEGORIES = ['Magic: The Gathering', 'Pokémon', 'Yu-Gi-Oh!', 'Warhammer', 'Video Games', 'Accessories'];
export const SUPPORTED_GAMES = ['Magic: The Gathering', 'Pokémon', 'Yu-Gi-Oh!'];

export function asMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function money(value) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(asMoney(value)); }

export function normalizeProduct(p = {}) {
  return {
    ...p,
    productName: String(p.productName ?? p.name ?? '').trim(),
    sku: String(p.sku ?? '').trim(),
    category: String(p.category ?? 'Accessories').trim(),
    salePrice: asMoney(p.salePrice ?? p.price ?? 0),
    quantityOnHand: Math.max(0, Math.trunc(Number(p.quantityOnHand ?? p.quantity ?? 0) || 0)),
    reorderPoint: Math.max(0, Math.trunc(Number(p.reorderPoint ?? 0) || 0)),
    imageUrl: String(p.imageUrl ?? p.image_url ?? ''),
    setCode: String(p.setCode ?? ''),
    collectorNumber: String(p.collectorNumber ?? ''),
    condition: String(p.condition ?? 'Near Mint'),
    finish: String(p.finish ?? 'Nonfoil'),
    language: String(p.language ?? 'English'),
    barcode: String(p.barcode ?? ''),
    isactive: p.isactive !== false && p.isActive !== false,
    published: p.published === true,
  };
}

export function productsFromResponse(value) {
  const entries = Array.isArray(value) ? value : value?.items;
  if (!Array.isArray(entries)) throw new Error('Catalog API did not return a product list.');
  return entries.map(normalizeProduct).filter(p => p.sku && p.productName && p.isactive);
}

export function sortAndFilterProducts(products, { search = '', category = 'All', sort = 'featured' } = {}) {
  const term = search.trim().toLocaleLowerCase();
  const filtered = products.filter(p => (category === 'All' || p.category === category) &&
    [p.productName, p.sku, p.category, p.setCode, p.collectorNumber].some(field => field.toLocaleLowerCase().includes(term)));
  return [...filtered].sort((a,b) => {
    if(sort === 'price-asc') return a.salePrice - b.salePrice;
    if(sort === 'price-desc') return b.salePrice - a.salePrice;
    if(sort === 'name') return a.productName.localeCompare(b.productName);
    if(sort === 'stock') return b.quantityOnHand - a.quantityOnHand;
    return 0;
  });
}

export function validateProduct(form) {
  const product = normalizeProduct(form);
  if (!product.productName) throw new Error('Product name is required.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(product.sku)) throw new Error('SKU must be 2–80 characters: letters, digits, periods, underscores, colons or hyphens.');
  if (!product.category) throw new Error('Category is required.');
  if (!Number.isFinite(Number(form.salePrice)) || Number(form.salePrice) < 0) throw new Error('Sale price must be a valid nonnegative number.');
  if (!Number.isSafeInteger(Number(form.quantityOnHand)) || Number(form.quantityOnHand) < 0) throw new Error('Stock must be a nonnegative whole number.');
  if (!Number.isSafeInteger(Number(form.reorderPoint ?? 0)) || Number(form.reorderPoint ?? 0) < 0) throw new Error('Reorder point must be a nonnegative whole number.');
  if (product.imageUrl && !/^https:\/\//i.test(product.imageUrl)) throw new Error('Image URL must use HTTPS.');
  return product;
}

export const BLANK_PRODUCT = {
  productName: '', sku: '', category: 'Magic: The Gathering', salePrice: 0,
  quantityOnHand: 1, reorderPoint: 0, imageUrl: '', setCode: '', collectorNumber: '',
  condition: 'Near Mint', finish: 'Nonfoil', language: 'English', barcode: '', isactive: true, published: false,
};

export function cartTotal(cart, products) {
  return Object.entries(cart).reduce((sum,[sku,qty]) => {
    const p = products.find(item => item.sku === sku);
    return sum + (p ? p.salePrice * Math.min(qty,p.quantityOnHand) : 0);
  },0);
}
