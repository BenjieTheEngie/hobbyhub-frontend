/**
 * Offline, draft-only intake for individually graded collectible card listings.
 * Does not call AWS, publish products, reserve stock or initiate checkout.
 */
const GAMES = new Set(['Magic: The Gathering','Pokémon','Yu-Gi-Oh!']);
const CONDITIONS = new Set(['Near Mint','Lightly Played','Moderately Played','Heavily Played','Damaged']);
const FINISHES = new Set(['Nonfoil','Foil','Etched Foil','Special']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
const clean = (v) => typeof v==='string' ? v.trim() : '';
export function previewCardInventoryDrafts(rows) {
  if(!Array.isArray(rows)||rows.length>250)throw Error('A batch of at most 250 card drafts is required.');
  const skus=new Set(),drafts=[],errors=[];
  for(const [index,row] of rows.entries()){
    try {
      if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Card draft must be an object.');
      const game=clean(row.game),productName=clean(row.productName),sku=clean(row.sku);
      const setCode=clean(row.setCode),collectorNumber=clean(row.collectorNumber);
      const condition=clean(row.condition),finish=clean(row.finish),language=clean(row.language);
      if(!GAMES.has(game))throw Error('Unsupported card game.');
      if(!productName||productName.length>160)throw Error('Card name must be 1–160 characters.');
      if(!ID.test(sku)||skus.has(sku.toLowerCase()))throw Error('SKU missing, malformed or duplicated in batch.');
      if(!setCode||setCode.length>32||!collectorNumber||collectorNumber.length>32)
        throw Error('Set code and collector number are required.');
      if(!CONDITIONS.has(condition)||!FINISHES.has(finish)||!language||language.length>40)
        throw Error('Condition, finish and language must be valid.');
      if(typeof row.quantity!=='number'||!Number.isSafeInteger(row.quantity)||row.quantity<1||row.quantity>10000)
        throw Error('Quantity must be a positive whole number.');
      if(typeof row.priceCents!=='number'||!Number.isSafeInteger(row.priceCents)||row.priceCents<1||row.priceCents>100000000)
        throw Error('Price must be a positive integer in cents.');
      skus.add(sku.toLowerCase());
      drafts.push(Object.freeze({game,productName,sku,setCode,collectorNumber,condition,finish,
        language,quantity:row.quantity,priceCents:row.priceCents,published:false,readyToPublish:false}));
    }catch(e){errors.push({row:index+1,message:e.message});}
  }
  return Object.freeze({mode:'draft-preview',canWrite:false,canPublish:false,canCheckout:false,
    validCount:drafts.length,errorCount:errors.length,drafts,errors});
}
