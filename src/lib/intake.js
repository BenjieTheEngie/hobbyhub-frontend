/** Hobby Hub card intake utilities. Product prices and exact variants always require human review. */
export const CATEGORIES=['Magic: The Gathering','Pokémon','Yu-Gi-Oh!','Warhammer','Video Games','Accessories'];
const API=(import.meta.env?.VITE_INVENTORY_API_BASE_URL||import.meta.env?.VITE_API_BASE_URL||'https://13bdy276e1.execute-api.us-east-2.amazonaws.com').replace(/\/$/,'');
const MEDIA=(import.meta.env?.VITE_MEDIA_API_BASE_URL||API).replace(/\/$/,'');
function err(text){throw new Error(text);}
async function parse(response){let data=await response.json().catch(()=>({}));if(!response.ok)err(data.message||data.error||'Request failed ('+response.status+').');return data;}
export function dollars(price){const x=Number(price);return Number.isFinite(x)&&x>=0?x.toFixed(2):'0.00';}
export function validProduct(p) {
  if(!String(p.productName||'').trim())err('Product name is required.');
  if(!/^[A-Za-z0-9][\w.:-]{1,79}$/.test(String(p.sku||'')))err('SKU must be 2–80 letters, numbers, periods, underscores, colons or hyphens.');
  if(p.salePrice==null||String(p.salePrice).trim()===""||!Number.isFinite(Number(p.salePrice))||Number(p.salePrice)<0)err('Enter a valid price.');
  if(p.quantityOnHand==null||String(p.quantityOnHand).trim()===""||!Number.isSafeInteger(Number(p.quantityOnHand))||Number(p.quantityOnHand)<0)err('Stock must be a nonnegative whole number.');
  if(p.imageUrl&&!/^https:\/\//i.test(p.imageUrl))err('Images need a secure HTTPS URL.');
  return {...p,sku:String(p.sku).trim(),productName:String(p.productName).trim(),salePrice:Number(p.salePrice),quantityOnHand:Number(p.quantityOnHand)};
}
export async function magicSearch(name,setCode='',collectorNumber=''){
  const url=setCode&&collectorNumber
    ?'https://api.scryfall.com/cards/'+encodeURIComponent(setCode.toLowerCase())+'/'+encodeURIComponent(collectorNumber)
    :'https://api.scryfall.com/cards/named?fuzzy='+encodeURIComponent(name.trim());
  if(!name.trim()&&!setCode)err('Enter a card name or a set and collector number.');
  const c=await parse(await fetch(url,{headers:{Accept:'application/json'}}));
  const img=c.image_uris?.normal||c.card_faces?.find(f=>f.image_uris?.normal)?.image_uris?.normal||'';
  return {productName:c.name,category:'Magic: The Gathering',setCode:c.set?.toUpperCase()||'',collectorNumber:c.collector_number||'',imageUrl:img};
}
export async function ygoSearch(name){
  if(!name.trim())err('Enter a Yu-Gi-Oh! card name.');
  const d=await parse(await fetch('https://db.ygoprodeck.com/api/v7/cardinfo.php?name='+encodeURIComponent(name.trim())));
  const c=d.data?.[0];if(!c)err('Card not found.');
  return {productName:c.name,category:'Yu-Gi-Oh!',setCode:c.card_sets?.[0]?.set_code||'',imageUrl:''};
}
function parseLine(line){
  const result=[];let field='',quoted=false;
  for(let i=0;i<line.length;i++){const c=line[i];
    if(c==='"'){if(quoted&&line[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){result.push(field);field='';}
    else field+=c;
  }
  if(quoted)err('CSV has an unclosed quoted field.');
  result.push(field);return result;
}
export function parseInventoryCsv(input){
  // Parse quoted cells, including commas and escaped quotes; reject embedded newlines rather than guessing.
  const lines=String(input).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim().split('\n').filter(Boolean);
  if(lines.length<2)err('CSV needs headers and at least one product.');
  if(lines.length>501)err('Import is limited to 500 rows.');
  const headers=parseLine(lines.shift()).map(x=>x.trim());
  for(const k of ['sku','productName','category','salePrice','quantityOnHand'])if(!headers.includes(k))err('CSV missing '+k+'.');
  const seen=new Set();
  return lines.map((line,i)=>{
    const row=parseLine(line);if(row.length!==headers.length)err('CSV column mismatch on row '+(i+2)+'.');
    const p=Object.fromEntries(headers.map((key,j)=>[key,row[j].trim()]));
    if(seen.has(p.sku))err('Duplicate SKU '+p.sku+' in CSV.');seen.add(p.sku);
    return validProduct({...p,published:p.published==='true',isactive:p.isactive!=='false'});
  });
}
export const csvHeader='sku,productName,category,salePrice,quantityOnHand,imageUrl,setCode,collectorNumber,condition,finish,language,published';
export function matchPhotoFiles(files,products){
  const bySku=new Map(products.map(p=>[String(p.sku).toLowerCase(),p]));
  const hits=[],rejected=[],seen=new Set();
  for(const file of files){
    const sku=file.name.replace(/\.(jpe?g|png|webp)$/i,'');
    const p=bySku.get(sku.toLowerCase());
    if(!/\.(jpe?g|png|webp)$/i.test(file.name)||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024||!file.size)rejected.push(file.name+' (invalid type or size)');
    else if(!p)rejected.push(file.name+' (no matching SKU)');
    else if(seen.has(p.sku))rejected.push(file.name+' (duplicate SKU)');
    else{seen.add(p.sku);hits.push({file,product:p});}
  }
  return {hits,rejected};
}
export async function uploadImage(file,token){
  if(!token)err('Sign in first.');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024)err('Image must be JPG, PNG, or WebP under 8MB.');
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
  const signed=await parse(await fetch(MEDIA+'/uploads/presign',{method:'POST',headers,body:JSON.stringify({filename:file.name,contentType:file.type,size:file.size})}));
  if(!signed.uploadUrl?.startsWith('https://')||!signed.key)err('AWS image upload is not yet configured.');
  let upload;
  if(signed.uploadMethod==='POST'){const data=new FormData();Object.entries(signed.fields||{}).forEach(([k,v])=>data.append(k,v));data.append('file',file);upload=await fetch(signed.uploadUrl,{method:'POST',body:data});}
  else if(signed.uploadMethod==='PUT')upload=await fetch(signed.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type},body:file});
  else err('Unsupported image upload contract.');
  if(!upload.ok)err('Image upload failed ('+upload.status+').');
  const finished=await parse(await fetch(MEDIA+'/uploads/complete',{method:'POST',headers,body:JSON.stringify({key:signed.key})}));
  if(!finished.imageUrl?.startsWith('https://'))err('Image could not be published.');
  return finished.imageUrl;
}
export async function scanPhoto(file,game,token){
  if(!["image/jpeg","image/png"].includes(file.type)||!file.size||file.size>8*1024*1024)err("Use JPG or PNG under 8 MB for scanning.");
  if(file.type==='image/webp')err('Photo recognition requires JPG or PNG.');
  if(!token)err('Sign in first.');
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
  // Reuse private-stage upload without publishing the raw scan.
  const signed=await parse(await fetch(MEDIA+'/uploads/presign',{method:'POST',headers,body:JSON.stringify({filename:file.name,contentType:file.type,size:file.size})}));
  if(!signed.uploadUrl?.startsWith('https://')||!signed.key)err('AWS scanner is not connected.');
  let response;
  if(signed.uploadMethod==='POST'){const data=new FormData();Object.entries(signed.fields||{}).forEach(([k,v])=>data.append(k,v));data.append('file',file);response=await fetch(signed.uploadUrl,{method:'POST',body:data});}
  else if(signed.uploadMethod==='PUT')response=await fetch(signed.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type},body:file});
  else err('Unsupported image upload contract.');
  if(!response.ok)err('Scanner photo upload failed.');
  return parse(await fetch(MEDIA+'/scan/recognize',{method:'POST',headers,body:JSON.stringify({key:signed.key,game})}));
}
export async function apiProduct(path,token,method='GET',body){
  const response=await fetch(API+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return parse(response);
}
