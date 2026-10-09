export const SHOP_CATEGORIES = ['All', 'Magic: The Gathering', 'Pokémon', 'Yu-Gi-Oh!', 'Warhammer', 'Video Games', 'Accessories'];

export function shopMoney(value) {
  const price = Number(value);
  return new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(Number.isFinite(price) && price >= 0 ? price : 0);
}

export function publishedCatalog(response) {
  const rows = Array.isArray(response) ? response : response?.items;
  if (!Array.isArray(rows)) throw new Error('Catalog returned an invalid product list.');
  // Count *every* raw SKU before publication filtering. Never choose one of
  // multiple legacy records sharing a SKU, regardless of publication state.
  const counts=new Map();
  for(const p of rows){
    const key=typeof p?.sku==='string'?p.sku.trim().toLowerCase():'';
    if(key)counts.set(key,(counts.get(key)||0)+1);
  }
  return rows.filter(p=>{
    if(!p || p.published!==true || p.isactive===false || p.isActive===false ||
      (p.status!==undefined && p.status!=='ACTIVE'))return false;
    const sku=String(p.sku??'').trim();
    return sku && counts.get(sku.toLowerCase())===1 &&
      p.quantityOnHand!==undefined && p.quantityOnHand!==null &&
      Number.isSafeInteger(Number(p.quantityOnHand)) && Number(p.quantityOnHand)>=0;
  }).map(p=>({
    sku:String(p.sku??'').trim(),productName:String(p.productName??p.name??'').trim(),
    category:String(p.category||'Accessories'),salePrice:Number(p.salePrice),
    quantityOnHand:Math.trunc(Number(p.quantityOnHand)),
    imageUrl:typeof p.imageUrl==='string' && /^https:\/\//i.test(p.imageUrl) ? p.imageUrl : '',
    setCode:String(p.setCode||''),collectorNumber:String(p.collectorNumber||''),
    condition:String(p.condition||''),finish:String(p.finish||''),
    createdAt:typeof p.createdAt==='string'?p.createdAt:'',
  })).filter(p=>p.sku && p.productName && Number.isFinite(p.salePrice) && p.salePrice>0 &&
    p.salePrice<=50000 && Math.abs(p.salePrice*100-Math.round(p.salePrice*100))<=1e-6);
}

export function shopFilter(products,{search='',category='All',sort='featured',savedSkus=[],savedOnly=false,availability='all'}={}) {
  const term=search.trim().toLocaleLowerCase();
  const saved=new Set(savedSkus);
  const filtered=products.filter(p=>(category==='All'||p.category===category) &&
    (!savedOnly || saved.has(p.sku)) &&
    (availability!=='in-stock' || p.quantityOnHand>0) &&
    [p.productName,p.category,p.sku,p.setCode,p.collectorNumber,p.condition,p.finish].some(v=>String(v||'').toLocaleLowerCase().includes(term)));
  return [...filtered].sort((a,b)=>{
    if(sort==='price-low')return a.salePrice-b.salePrice;
    if(sort==='price-high')return b.salePrice-a.salePrice;
    if(sort==='name')return a.productName.localeCompare(b.productName);
    if(sort==='new')return String(b.createdAt||'').localeCompare(String(a.createdAt||'')) || b.sku.localeCompare(a.sku);
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

export function safeSavedWishlist(serialized) {
  try {
    const rows=JSON.parse(serialized);
    if(!Array.isArray(rows))return [];
    const unique=new Set();
    return rows.filter(sku=>{
      if(typeof sku!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(sku)||
        unique.has(sku)||unique.size>=200)return false;
      unique.add(sku);return true;
    });
  }catch{return [];}
}
export function toggleSavedProduct(saved,sku) {
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(sku))return saved;
  return saved.includes(sku) ? saved.filter(s=>s!==sku) : [...saved,sku].slice(-200);
}
