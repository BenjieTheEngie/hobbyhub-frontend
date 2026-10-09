import {PACKAGING_COLUMNS,measuredPackagingProfile} from './packagingWorksheet.js';
import {validateLocalPackageDraft,savePackageDrafts} from './localPackaging.js';

const MAX_CHARS=400000;
const MAX_ROWS=2500;
/**
 * Parse the export's RFC4180-style CSV with quoted commas and doubled quotes.
 * Parsing and validation happen entirely in the browser. No network calls.
 */
export function parsePackagingCsv(csv) {
  if(typeof csv!=='string'||!csv.length||csv.length>MAX_CHARS)
    throw Error('Packaging CSV is empty or exceeds the 400 KB import limit.');
  const source=csv.charCodeAt(0)===0xfeff?csv.slice(1):csv;
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  const pushCell=()=>{row.push(cell);cell='';closed=false;};
  const pushRow=()=>{
    pushCell();
    rows.push(row);row=[];
    if(rows.length>MAX_ROWS+1)throw Error('Packaging CSV exceeds the 2500-row limit.');
  };
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(quoted){
      if(ch==='"' && source[i+1]==='"'){cell+='"';i++;}
      else if(ch==='"'){quoted=false;closed=true;}
      else cell+=ch;
      continue;
    }
    if(ch==='"'){
      if(cell!==''||closed)throw Error('Malformed CSV quoting.');
      quoted=true;continue;
    }
    if(ch===','){pushCell();continue;}
    if(ch==='\n'||ch==='\r'){
      if(ch==='\r'&&source[i+1]==='\n')i++;
      pushRow();continue;
    }
    if(closed)throw Error('Unexpected text after a quoted CSV field.');
    cell+=ch;
  }
  if(quoted)throw Error('CSV has an unclosed quoted field.');
  if(cell!==''||closed||row.length>0)pushRow();
  if(!rows.length)throw Error('CSV contains no header.');
  const header=rows.shift();
  if(JSON.stringify(header)!==JSON.stringify(PACKAGING_COLUMNS))
    throw Error('Packaging CSV columns do not match the official worksheet format.');
  for(const row of rows)if(row.length!==PACKAGING_COLUMNS.length)
    throw Error('Packaging CSV has an incorrect number of columns.');
  return rows.map(row=>Object.fromEntries(PACKAGING_COLUMNS.map((name,i)=>[name,row[i]])));
}
/**
 * All-or-nothing browser-local import keyed by current Product productId+SKU.
 * Never trusts the CSV to create AWS products or override server-side package
 * records; never uploads addresses, SKUs or files to a service.
 */
export function preparePackagingCsvImport(csv,products,existingDrafts={}) {
  if(!Array.isArray(products)||!existingDrafts||typeof existingDrafts!=='object')
    throw Error('A verified current Products list is required.');
  const current=new Map();
  for(const p of products){
    if(typeof p?.productId!=='string'||!p.productId||current.has(p.productId))
      throw Error('Products list contains missing or duplicate product identities.');
    current.set(p.productId,p);
  }
  const parsed=parsePackagingCsv(csv);
  const imported={};const seen=new Set();
  let blanks=0;
  for(const row of parsed){
    const id=row.productId;
    if(!id||seen.has(id))throw Error('Packaging CSV has missing or repeated product IDs.');
    seen.add(id);
    const product=current.get(id);
    if(!product)throw Error('Packaging CSV contains an unknown productId; nothing imported.');
    if(row.sku!==String(product.sku||''))
      throw Error('Packaging CSV SKU differs from the current product; nothing imported.');
    const measurements=[
      row.packedLengthIn,row.packedWidthIn,row.packedHeightIn,row.packedWeightOz
    ];
    if(measurements.every(value=>value==='')){blanks++;continue;}
    if(measurements.some(value=>value===''))
      throw Error('Every package requires all four measured dimensions and weight.');
    if(measuredPackagingProfile(product))
      throw Error('This product already has authoritative server-side packaging; refusing to replace it.');
    imported[id]=validateLocalPackageDraft({
      lengthIn:row.packedLengthIn,widthIn:row.packedWidthIn,
      heightIn:row.packedHeightIn,weightOz:row.packedWeightOz,
      note:row.packagingNotes
    });
  }
  const next={...existingDrafts,...imported};
  const serialized=savePackageDrafts(next);
  return {next,serialized,importedCount:Object.keys(imported).length,
    skippedEmpty:blanks,reviewedCount:parsed.length,
    // User must choose a local file; this is never sent to AWS.
    awsWrites:false
  };
}
