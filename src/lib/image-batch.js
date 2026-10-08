const TYPES=new Set(['image/jpeg','image/png','image/webp']);
export function matchImageFiles(files,inventory) {
  const bySku=new Map(inventory.map(p=>[p.sku,p]));
  const accepted=[],rejected=[],seen=new Set();
  for(const file of files){
    const filename=String(file?.name||''), match=/^(.+)\.(jpe?g|png|webp)$/i.exec(filename);
    if(!match||!TYPES.has(file.type)||!file.size||file.size>8*1024*1024){rejected.push({filename,reason:'Unsupported file type or size above 8 MB.'});continue;}
    const sku=match[1];
    if(!bySku.has(sku)){rejected.push({filename,reason:`No inventory record for SKU ${sku}.`});continue;}
    if(seen.has(sku)){rejected.push({filename,reason:`Duplicate image for SKU ${sku}.`});continue;}
    seen.add(sku);accepted.push({file,product:bySku.get(sku)});
  }
  return {accepted,rejected};
}
