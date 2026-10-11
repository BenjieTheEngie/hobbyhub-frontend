/** Offline-only validation for administrator-authored card drafts.
 * Does not write Products, Stock V2, or publication approvals.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SKU=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
const GAMES=new Set(['Magic: The Gathering','Pokémon','Yu-Gi-Oh!']);
const CONDITIONS=new Set(['NM','LP','MP','HP','DMG']);
const FINISHES=new Set(['nonfoil','foil','etched']);
const LANGUAGES=new Set(['English','Japanese','French','German','Italian','Spanish','Portuguese','Korean','Chinese']);
function requiredString(value,max,label){
  if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>max)
    throw Error(label+' is required and must be trimmed.');
  return value;
}
export function validateCardDraft(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw Error('Card draft must be an object.');
  const allowed=new Set(['productId','sku','productName','category','setCode','collectorNumber','condition','finish','language','imageUrl','salePrice','quantity','status']);
  if(Object.keys(input).some(key=>!allowed.has(key)))
    throw Error('Card draft contains unsupported fields.');
  const productId=requiredString(input.productId,128,'productId');
  const sku=requiredString(input.sku,80,'SKU');
  if(!ID.test(productId)||!SKU.test(sku))throw Error('Invalid immutable productId or SKU.');
  const productName=requiredString(input.productName,200,'Card name');
  const category=requiredString(input.category,40,'Game');
  if(!GAMES.has(category))throw Error('Unsupported card game.');
  const setCode=requiredString(input.setCode,32,'Set code');
  const collectorNumber=requiredString(input.collectorNumber,32,'Collector number');
  if(!/^[A-Za-z0-9][A-Za-z0-9._/+#-]*$/.test(setCode)||
     !/^[A-Za-z0-9][A-Za-z0-9._/+#-]*$/.test(collectorNumber))
    throw Error('Invalid set code or collector number.');
  if(!CONDITIONS.has(input.condition)||!FINISHES.has(input.finish)||
     !LANGUAGES.has(input.language))throw Error('Invalid card condition, finish or language.');
  if(input.status!==undefined&&input.status!=='DRAFT')
    throw Error('New card entries must remain unpublished drafts.');
  if(typeof input.salePrice!=='number'||!Number.isFinite(input.salePrice)||
     input.salePrice<=0||input.salePrice>50000||
     Math.abs(input.salePrice*100-Math.round(input.salePrice*100))>1e-6)
    throw Error('Price must be positive exact cents.');
  if(!Number.isSafeInteger(input.quantity)||input.quantity<0||input.quantity>100000)
    throw Error('Quantity must be a nonnegative whole number.');
  const imageUrl=input.imageUrl??'';
  if(typeof imageUrl!=='string'||imageUrl.length>500||
     (imageUrl&&!/^https:\/\/[^\s/?#]+(?:[^\s]*)$/i.test(imageUrl)))
    throw Error('Card image must be an HTTPS URL.');
  return Object.freeze({productId,sku,productName,category,setCode,collectorNumber,
    condition:input.condition,finish:input.finish,language:input.language,
    imageUrl,salePrice:Math.round(input.salePrice*100)/100,quantity:input.quantity,
    status:'DRAFT',published:false});
}
