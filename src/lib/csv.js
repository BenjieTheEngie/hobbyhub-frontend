// RFC4180-style basic CSV parser: quoted fields, escaped quotes, CRLF, and embedded newlines.
export function parseCsv(text) {
  const rows=[];let row=[],field='',quoted=false;
  const input=String(text).replace(/^\uFEFF/,'');
  for(let i=0;i<input.length;i++){
    const ch=input[i];
    if(ch==='"') {
      if(quoted && input[i+1]==='"'){field+='"';i++;}else if(quoted){quoted=false;}
      else if(field===''){quoted=true;}else{field+=ch;}
    } else if(ch===',' && !quoted){row.push(field);field='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){
      if(ch==='\r'&&input[i+1]==='\n')i++;
      row.push(field); if(row.some(v=>v.trim()))rows.push(row);
      row=[];field='';
    } else{field+=ch;}
  }
  if(quoted)throw new Error('CSV contains an unclosed quoted field.');
  row.push(field);if(row.some(v=>v.trim()))rows.push(row);
  if(!rows.length)return [];
  const header=rows.shift().map(v=>v.trim());
  for(const required of ['sku','productName','category','salePrice','quantityOnHand']) if(!header.includes(required)) throw new Error(`CSV header must contain ${required}.`);
  return rows.map((values,index)=>{
    if(values.length!==header.length)throw new Error(`CSV row ${index+2} has ${values.length} columns; expected ${header.length}.`);
    return Object.fromEntries(header.map((column,j)=>[column,values[j].trim()]));
  });
}

export function csvTemplate() {
  return 'sku,productName,category,salePrice,quantityOnHand,reorderPoint,imageUrl,setCode,collectorNumber,condition,finish,language,barcode\n';
}
