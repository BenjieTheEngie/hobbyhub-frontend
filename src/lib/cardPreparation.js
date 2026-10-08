const HTTPS_SCRYFALL=/^https:\/\/api\.scryfall\.com\//i;

export function suggestSku(product,existing=[],finish='Nonfoil') {
  const prefix=product.category==='Yu-Gi-Oh!'?'YGO':product.category==='Pokémon'?'PKM':'MTG';
  const token=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9.-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,30);
  const set=token(product.setCode)||'UNKNOWN';
  const collector=token(product.collectorNumber)||token(product.productName).slice(0,22)||'CARD';
  const finishCode=finish==='Foil'?'F':finish==='Etched'?'E':'N';
  const base=[prefix,set,collector,finishCode].join('-').slice(0,72);
  const occupied=new Set(existing.map(p=>String(p.sku||'').toUpperCase()));
  if(!occupied.has(base))return base;
  for(let i=2;i<10000;i++) {
    const suffix='-'+i;
    const candidate=base.slice(0,80-suffix.length)+suffix;
    if(!occupied.has(candidate))return candidate;
  }
  throw new Error('Could not generate a unique SKU.');
}

export function normalizeMagicPrinting(card) {
  if(!card || typeof card!=='object' || !card.id || !card.name || !card.set) return null;
  const image=card.image_uris?.normal || card.card_faces?.find(face=>face.image_uris?.normal)?.image_uris?.normal || '';
  return {
    id:String(card.id), productName:String(card.name), category:'Magic: The Gathering',
    setCode:String(card.set).toUpperCase(),setName:String(card.set_name||card.set),
    collectorNumber:String(card.collector_number||''), imageUrl:/^https:\/\//i.test(image)?image:'',
    rarity:String(card.rarity||''), language:String(card.lang||'en'),
    releasedAt:String(card.released_at||''), finishes:Array.isArray(card.finishes)?card.finishes:['nonfoil'],
  };
}

/** Scryfall's prints_search_uri identifies the actual printings of the resolved card.
 * Cap at a single page to avoid excessive requests and give users a filterable selection.
 */
export async function magicPrintings(name,{signal}={}) {
  const clean=String(name||'').trim();
  if(clean.length<2 || clean.length>150)throw new Error('Enter a card name (2–150 characters).');
  const named=await fetch('https://api.scryfall.com/cards/named?fuzzy='+encodeURIComponent(clean),{signal,headers:{Accept:'application/json'}});
  const card=await named.json().catch(()=>({}));
  if(!named.ok)throw new Error(card.details||'Magic card not found. Check the name.');
  const uri=card.prints_search_uri;
  if(typeof uri!=='string' || !HTTPS_SCRYFALL.test(uri))throw new Error('Scryfall did not provide a safe printing lookup.');
  const response=await fetch(uri,{signal,headers:{Accept:'application/json'}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok || !Array.isArray(data.data))throw new Error(data.details||'Could not load available printings.');
  const options=data.data.map(normalizeMagicPrinting).filter(Boolean);
  const unique=[...new Map(options.map(p=>[p.setCode+'|'+p.collectorNumber+'|'+p.language,p])).values()];
  return {resolvedName:String(card.name||clean),items:unique,hasMore:data.has_more===true};
}
export function pickPrinting(printing,existing=[],finish='Nonfoil') {
  if(!printing || !printing.productName)throw new Error('Choose a valid printing.');
  return {
    productName:printing.productName,category:'Magic: The Gathering',
    setCode:printing.setCode,collectorNumber:printing.collectorNumber,
    imageUrl:printing.imageUrl,
    finish, language:printing.language==='en'?'English':printing.language,
    sku:suggestSku(printing,existing,finish),
  };
}
export function csvEscape(value) {
  const text=String(value??'');
  return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;
}
export function exportInventoryCsv(rows,headers) {
  if(!Array.isArray(rows)||!Array.isArray(headers)||!headers.length)throw new Error('CSV requires rows and column headers.');
  return '\uFEFF'+headers.map(csvEscape).join(',')+'\r\n'+rows.map(row=>headers.map(key=>csvEscape(row[key])).join(',')).join('\r\n')+(rows.length?'\r\n':'');
}
export function importPreview(rows,existing=[]) {
  const known=new Set(existing.map(p=>String(p.sku||'').toLowerCase()));
  const duplicates=rows.filter(p=>known.has(String(p.sku||'').toLowerCase()));
  const missingPrice=rows.filter(p=>!Number.isFinite(Number(p.salePrice))||Number(p.salePrice)<=0);
  const unpublished=rows.filter(p=>p.published!==true);
  return {total:rows.length,newCount:rows.length-duplicates.length,duplicateSkus:duplicates.map(p=>p.sku),priceReview:missingPrice.map(p=>p.sku),unpublishedCount:unpublished.length};
}
