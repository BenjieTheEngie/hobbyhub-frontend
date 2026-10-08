export const SHOP_CATEGORIES = ['All', 'Magic: The Gathering', 'Pokémon', 'Yu-Gi-Oh!', 'Warhammer', 'Video Games', 'Accessories'];

export function shopMoney(value) {
  const price = Number(value);
  return new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(Number.isFinite(price) && price >= 0 ? price : 0);
}

export function publishedCatalog(response) {
  const rows = Array.isArray(response) ? response : response?.items;
  if (!Array.isArray(rows)) throw new Error('Catalog returned an invalid product list.');
  return rows.filter(p=>p && p.published !== false && p.isactive !== false && p.isActive !== false)
    .map(p=>({
      sku:String(p.sku??'').trim(),productName:String(p.productName??p.name??'').trim(),
      category:String(p.category||'Accessories'),salePrice:Number(p.salePrice),
      quantityOnHand:Math.max(0,Math.trunc(Number(p.quantityOnHand)||0)),
      imageUrl:typeof p.imageUrl === 'string' && /^https:\/\//i.test(p.imageUrl) ? p.imageUrl : '',
      setCode:String(p.setCode||''),collectorNumber:String(p.collectorNumber||''),
      condition:String(p.condition||''),finish:String(p.finish||''),
    }))
    .filter(p=>p.sku && p.productName && Number.isFinite(p.salePrice) && p.salePrice >= 0);
}

export function shopFilter(products,{search='',category='All',sort='featured'}={}) {
  const term=search.trim().toLocaleLowerCase();
  const filtered=products.filter(p=>(category==='All'||p.category===category) &&
    [p.productName,p.category,p.sku,p.setCode,p.collectorNumber].some(v=>String(v||'').toLocaleLowerCase().includes(term)));
  return [...filtered].sort((a,b)=>{
    if(sort==='price-low')return a.salePrice-b.salePrice;
    if(sort==='price-high')return b.salePrice-a.salePrice;
    if(sort==='name')return a.productName.localeCompare(b.productName);
    if(sort==='new')return b.sku.localeCompare(a.sku);
    return 0;
  });
}
export function safeSavedCart(serialized) {
  try {
    const parsed=JSON.parse(serialized);
    if(!Array.isArray(parsed))return [];
    const used=new Set();
    return parsed.slice(0,100).filter(row=>{
      if(!row || typeof row.sku!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(row.sku) || used.has(row.sku))return false;
      used.add(row.sku);return true;
    }).map(row=>({sku:row.sku,cartQuantity:Math.min(99,Math.max(1,Math.trunc(Number(row.cartQuantity)||1)))}));
  }catch{return [];}
}
export function reconcileCart(cart,products) {
  const bySku=new Map(products.map(p=>[p.sku,p]));
  return cart.flatMap(item=>{
    const product=bySku.get(item.sku);
    if(!product || product.quantityOnHand < 1)return [];
    return [{...product,cartQuantity:Math.min(99,product.quantityOnHand,Math.max(1,Math.trunc(Number(item.cartQuantity)||1)))}];
  });
}
export function setCartQuantity(cart,sku,quantity) {
  return cart.map(item=>item.sku===sku ? {...item,cartQuantity:Math.min(99,Math.max(1,Math.trunc(Number(quantity)||1)),item.quantityOnHand)} : item);
}
