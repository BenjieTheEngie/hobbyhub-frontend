import React,{useMemo,useRef,useEffect,useState} from 'react';
import {apiProduct,csvHeader,magicSearch,matchPhotoFiles,parseInventoryCsv,scanPhoto,uploadImage,ygoSearch} from '../lib/intake.js';
import {magicPrintings,pickPrinting,suggestSku,exportInventoryCsv,importPreview} from '../lib/cardPreparation.js';
import './card-intake.css';

const mediaReady=Boolean(import.meta.env.VITE_MEDIA_API_BASE_URL);
const inventoryReady=Boolean(import.meta.env.VITE_INVENTORY_API_BASE_URL);

function saveFile(filename,content,type='text/csv;charset=utf-8') {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=document.createElement('a');
  link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1500);
}

export default function IntakePanel({token,products=[],onFill,onUpdated}) {
  const [name,setName]=useState('');
  const [setCode,setSetCode]=useState('');
  const [collector,setCollector]=useState('');
  const [printings,setPrintings]=useState([]);
  const [resolved,setResolved]=useState('');
  const [hasMore,setHasMore]=useState(false);
  const [finish,setFinish]=useState('Nonfoil');
  const [rows,setRows]=useState([]);
  const [previewPage,setPreviewPage]=useState(1);
  const [photos,setPhotos]=useState([]);
  const [rejectedPhotos,setRejectedPhotos]=useState([]);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [game,setGame]=useState('Magic: The Gathering');
  const [barcode,setBarcode]=useState('');
  const [camera,setCamera]=useState(false);
  const video=useRef(null),stream=useRef(null),timer=useRef(null);
  const abort=useRef(null);
  const preview=useMemo(()=>importPreview(rows,products),[rows,products]);
  const filtered=useMemo(()=>printings.filter(p=>{
    return (!setCode.trim() || p.setCode.toLowerCase().includes(setCode.trim().toLowerCase())) &&
      (!collector.trim() || String(p.collectorNumber).toLowerCase().includes(collector.trim().toLowerCase()));
  }),[printings,setCode,collector]);
  function stopCamera() {
    if(timer.current)window.clearInterval(timer.current);
    timer.current=null;
    if(stream.current)stream.current.getTracks().forEach(track=>track.stop());
    stream.current=null;
    if(video.current)video.current.srcObject=null;
    setCamera(false);
  }
  useEffect(()=>()=>{abort.current?.abort();if(timer.current)window.clearInterval(timer.current);if(stream.current)stream.current.getTracks().forEach(t=>t.stop());},[]);
  async function run(operation) {
    setBusy(true);setError('');setNotice('');
    try{await operation();}catch(e){if(e.name!=='AbortError')setError(e.message||'Something went wrong.');}
    finally{setBusy(false);}
  }
  function copyToEditor(draft) {
    onFill(draft);
    setNotice('Product information copied to the editor below. Review its name, printing, condition, price, stock and image permissions before saving.');
    window.requestAnimationFrame(()=>document.getElementById('product-editor')?.scrollIntoView({behavior:'smooth',block:'start'}));
  }
  async function loadPrintings() {
    await run(async()=>{
      abort.current?.abort();
      abort.current=new AbortController();
      if(!name.trim()&&setCode.trim()&&collector.trim()) {
        const p=await magicSearch('',setCode.trim(),collector.trim());
        const draft={...p,finish,sku:suggestSku(p,products,finish)};
        copyToEditor(draft);setPrintings([]);
        return;
      }
      const result=await magicPrintings(name,{signal:abort.current.signal});
      setPrintings(result.items);
      setResolved(result.resolvedName);
      setHasMore(result.hasMore);
      setNotice(result.items.length+' printings loaded for '+result.resolvedName+'. Select the correct set and collector number before adding a product.');
    });
  }
  async function searchYgo() {
    await run(async()=>{
      const p=await ygoSearch(name);
      copyToEditor({...p,sku:suggestSku(p,products,'Nonfoil'),finish:'Nonfoil'});
    });
  }
  function usePrinting(printing) {
    try{copyToEditor(pickPrinting(printing,products,finish));}
    catch(e){setError(e.message);}
  }
  async function csvSelect(event) {
    const file=event.target.files?.[0];event.target.value='';
    if(!file)return;
    await run(async()=>{
      if(file.size>1024*1024)throw Error('CSV file must be under 1 MB.');
      const parsed=parseInventoryCsv(await file.text());
      setRows(parsed);setPreviewPage(1);
      const info=importPreview(parsed,products);
      setNotice(info.total+' rows prepared locally: '+info.newCount+' new SKU(s), '+info.duplicateSkus.length+' existing SKU(s). Nothing has been saved to AWS.');
    });
  }
  function csvDownload() {
    if(!rows.length)return;
    saveFile('hobbyhub-inventory-reviewed.csv',exportInventoryCsv(rows,csvHeader.split(',')));
    setNotice('Prepared CSV downloaded. You can finish pricing and prepare your catalog offline; no AWS data was changed.');
  }
  async function artAutofill() {
    await run(async()=>{
      let n=0,failed=0;
      const items=rows.map(row=>({...row}));
      for(const p of items) {
        if(n+failed>=40)break;
        if(p.category==='Magic: The Gathering'&&p.setCode&&p.collectorNumber&&!p.imageUrl){
          try{const m=await magicSearch('',p.setCode,p.collectorNumber);p.imageUrl=m.imageUrl;n++;}
          catch{failed++;}
          await new Promise(resolve=>window.setTimeout(resolve,130));
        }
      }
      setRows(items);
      setNotice(n+' card image links prepared; '+failed+' lookup(s) unavailable. Review commercial image use before publishing.');
    });
  }
  async function importToAws() {
    if(!inventoryReady){setError('Inventory API is not connected. Download the reviewed CSV and import after AWS is configured.');return;}
    if(!window.confirm('Create only NEW SKUs in AWS? Already existing SKUs will be skipped.'))return;
    await run(async()=>{
      const existing=new Set(products.map(p=>String(p.sku).toLowerCase()));
      let count=0,skipped=0;
      const remaining=[];
      let failure='';
      for(const product of rows) {
        if(existing.has(product.sku.toLowerCase())){skipped++;continue;}
        if(failure){remaining.push(product);continue;}
        try{await apiProduct('/products',token,'POST',product);count++;}
        catch(e){remaining.push(product);failure=product.sku+': '+e.message;}
      }
      setRows(remaining);
      await onUpdated();
      setNotice(count+' created, '+skipped+' skipped. '+(failure?'Stopped on '+failure+'; unprocessed rows retained.':'All requests completed.'));
    });
  }
  function selectPhotos(event) {
    const files=Array.from(event.target.files||[]);
    event.target.value='';
    if(files.length>100){setError('Select no more than 100 files per batch.');return;}
    const results=matchPhotoFiles(files,products);
    setPhotos(results.hits);setRejectedPhotos(results.rejected);
    setNotice(results.hits.length+' photos matched to current inventory SKU filenames. This preview does not upload files.');
  }
  async function savePhotos() {
    if(!mediaReady||!inventoryReady){setError('Secure photo upload requires deployed AWS media and inventory API URLs.');return;}
    if(!window.confirm('Upload matched photos and update those AWS records?'))return;
    await run(async()=>{
      let count=0;const remaining=[];
      let fail='';
      for(const hit of photos) {
        if(fail){remaining.push(hit);continue;}
        try {
          const imageUrl=await uploadImage(hit.file,token);
          await apiProduct('/products/'+encodeURIComponent(hit.product.sku),token,'PUT',{...hit.product,imageUrl});
          count++;
        }catch(e){fail=hit.product.sku+': '+e.message;remaining.push(hit);}
      }
      setPhotos(remaining);
      await onUpdated();
      setNotice(count+' photos attached. '+(fail?'Stopped at '+fail+'; remaining matches kept.':'All finished.'));
    });
  }
  async function photoScan(event) {
    const file=event.target.files?.[0];event.target.value='';
    if(!file)return;
    if(!mediaReady){setError('Photo recognition needs the private AWS scanning API. Use name/set lookup today.');return;}
    await run(async()=>{
      const result=await scanPhoto(file,game,token);
      const match=result.product||result.match;
      if(!match?.productName)throw Error('No suitable match. Try a manual name search.');
      copyToEditor({...match,category:game,sku:suggestSku({...match,category:game},products)});
    });
  }
  async function startCamera() {
    setError('');
    try {
      if(!window.BarcodeDetector||!navigator.mediaDevices?.getUserMedia)throw Error('Your browser cannot scan barcodes. Enter the number manually.');
      const formats=(await window.BarcodeDetector.getSupportedFormats()).filter(x=>['ean_13','ean_8','upc_a','upc_e','code_128'].includes(x));
      if(!formats.length)throw Error('This browser does not support the requested barcode formats.');
      const detector=new window.BarcodeDetector({formats});
      stream.current=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
      if(!video.current){stopCamera();return;}
      video.current.srcObject=stream.current;await video.current.play();setCamera(true);
      timer.current=window.setInterval(async()=>{
        try{
          if(!video.current||video.current.readyState<2)return;
          const hits=await detector.detect(video.current);
          if(hits.length){setBarcode(hits[0].rawValue);onFill({barcode:hits[0].rawValue});setNotice('Barcode copied to product editor. Verify the item before saving.');stopCamera();}
        }catch(e){setError(e.message);stopCamera();}
      },700);
    }catch(e){stopCamera();setError(e.message||'Could not access camera.');}
  }
  const visibleRows=rows.slice((previewPage-1)*10,previewPage*10);
  const pageCount=Math.ceil(rows.length/10);
  return <section className="intake-section hh-intake" aria-labelledby="hh-intake-heading">
    <div className="hh-intake-heading"><div><span className="hh-kicker">INVENTORY PREPARATION</span><h2 id="hh-intake-heading">Card intake studio</h2><p>Find exact printings and prepare products before the AWS inventory connection is ready.</p></div><span className="hh-local-tag">LOOKUP & CSV WORK OFFLINE FROM AWS</span></div>
    {notice&&<p role="status" className="intake-success">{notice}</p>}{error&&<p role="alert" className="intake-error">{error}</p>}
    <div className="hh-intake-grid">
      <div className="intake-box hh-lookup">
        <span className="hh-step">01 / CARD RESEARCH</span><h3>Find the right card</h3>
        <label>Card name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Lightning Bolt" autoComplete="off"/></label>
        <div className="intake-two"><label>Set code (optional)<input value={setCode} onChange={e=>setSetCode(e.target.value)} placeholder="MH3"/></label><label>Collector number (optional)<input value={collector} onChange={e=>setCollector(e.target.value)} placeholder="123"/></label></div>
        <label>Finish<select value={finish} onChange={e=>setFinish(e.target.value)}><option>Nonfoil</option><option>Foil</option><option>Etched</option></select></label>
        <div className="hh-intake-buttons"><button type="button" disabled={busy||(!name.trim()&&!(setCode&&collector))} onClick={loadPrintings}>{busy?'Looking up…':'Search Magic printings'}</button><button type="button" className="secondary" disabled={busy||!name.trim()} onClick={searchYgo}>Find Yu-Gi-Oh!</button></div>
        <small className="hh-help">Scryfall supplies Magic metadata. Artwork, prices, condition and commercial usage must be verified before listing.</small>
      </div>
      <div className="intake-box hh-lookup-guide"><span className="hh-step">HOW IT WORKS</span><h3>Know exactly what you're listing.</h3>
        <div className="hh-steps"><p><b>1.</b> Search for a card by name or set number.</p><p><b>2.</b> Choose its exact printing and finish.</p><p><b>3.</b> Copy the suggested SKU, set and art link into the editor.</p><p><b>4.</b> Review price and condition. Save to AWS after the inventory endpoint is enabled.</p></div>
        <span className="hh-local-note">Lookup works now • Saving to AWS requires the backend</span>
      </div>
    </div>
    {printings.length>0&&<div className="intake-box hh-printings">
      <div className="hh-printing-heading"><div><h3>{resolved} — available printings</h3><p>{filtered.length} of {printings.length} retrieved printings shown{hasMore?'; Scryfall has additional older printings':''}.</p></div><button type="button" className="secondary" onClick={()=>{setPrintings([]);setSetCode('');setCollector('');}}>Clear results</button></div>
      <div className="hh-printings-grid">{filtered.slice(0,36).map(p=><button type="button" key={p.id} className="hh-printing" onClick={()=>usePrinting(p)} disabled={busy}>
        {p.imageUrl?<img loading="lazy" src={p.imageUrl} alt={p.productName+' '+p.setCode+' #'+p.collectorNumber}/>:<span className="hh-no-print-image">No art</span>}
        <span className="hh-printing-name">{p.setName}</span><small>{p.setCode} · #{p.collectorNumber} · {p.releasedAt||p.language}</small><b>Use this printing ↗</b>
      </button>)}</div>
      {filtered.length>36&&<p className="hh-help">Showing 36 matches. Enter a set code or collector number above to narrow the results.</p>}
      {!filtered.length&&<p className="hh-help">No retrieved printings match the current filters. Try clearing the set/collector fields or search the exact set and collector number.</p>}
    </div>}
    <div className="hh-intake-grid">
      <div className="intake-box"><span className="hh-step">02 / LABELS & SCANNING</span><h3>Barcode tools</h3>
        <p>Scan UPC/EAN from a product box or enter the number. This only fills the editor; it does not identify the card.</p>
        <div className="intake-camera"><video ref={video} muted playsInline/>{!camera&&<span>Camera preview off</span>}</div>
        <div className="hh-intake-buttons"><button type="button" className="secondary" onClick={camera?stopCamera:startCamera}>{camera?'Stop camera':'Scan barcode'}</button></div>
        <label>Manual barcode<input inputMode="numeric" value={barcode} onChange={e=>setBarcode(e.target.value)} placeholder="UPC / EAN"/></label>
        <button type="button" disabled={!barcode.trim()} onClick={()=>copyToEditor({barcode:barcode.trim()})}>Copy barcode to editor</button>
      </div>
      <div className="intake-box"><span className="hh-step">03 / IMAGE PREPARATION</span><h3>Batch photo matching</h3>
        <p>Name your photos after inventory SKUs (e.g. <code>MTG-MH3-123-N.jpg</code>). Prepare up to 100 images at once.</p>
        <label className="intake-upload">Select local photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={selectPhotos}/></label>
        {photos.length>0&&<p className="hh-help"><b>{photos.length} matched:</b> {photos.slice(0,6).map(p=>p.product.sku).join(', ')}{photos.length>6?' …':''}</p>}
        {rejectedPhotos.length>0&&<p className="hh-help">{rejectedPhotos.length} unmatched: {rejectedPhotos.slice(0,3).join('; ')}</p>}
        <button type="button" disabled={!mediaReady||!inventoryReady||!photos.length||busy} onClick={savePhotos}>Attach matched photos to AWS</button>
        {!mediaReady&&<small className="hh-help">Local SKU matching is available. Actual uploads require the AWS media API.</small>}
        <hr className="hh-rule"/>
        <h3>Identify card from a photo</h3><label>Game<select value={game} onChange={e=>setGame(e.target.value)}><option>Magic: The Gathering</option><option>Pokémon</option><option>Yu-Gi-Oh!</option></select></label>
        <label className="intake-upload">Choose camera photo<input disabled={!mediaReady||busy} type="file" accept="image/jpeg,image/png" capture="environment" onChange={photoScan}/></label>
        {!mediaReady&&<small className="hh-help">Camera-based card recognition remains disabled until the private AWS scanner is connected.</small>}
      </div>
    </div>
    <div className="intake-box hh-csv-studio"><span className="hh-step">04 / BULK PRODUCT PREPARATION</span>
      <div className="hh-printing-heading"><div><h3>CSV inventory workspace</h3><p>Validate, review, enrich and download a product sheet without saving anything to AWS.</p></div>
        <button type="button" className="secondary" onClick={()=>saveFile('hobbyhub-inventory-template.csv',exportInventoryCsv([],csvHeader.split(',')))}>Download template</button>
      </div>
      <label className="intake-upload">Choose inventory CSV (up to 500 rows / 1 MB)<input type="file" accept=".csv,text/csv" disabled={busy} onChange={csvSelect}/></label>
      {rows.length>0&&<>
        <div className="hh-csv-stats"><span><b>{preview.total}</b> rows reviewed</span><span><b>{preview.newCount}</b> new SKUs</span><span><b>{preview.duplicateSkus.length}</b> already in inventory</span><span><b>{preview.priceReview.length}</b> need pricing review</span></div>
        {preview.duplicateSkus.length>0&&<p className="hh-help">Already existing SKUs will be skipped on AWS import: {preview.duplicateSkus.slice(0,8).join(', ')}.</p>}
        {preview.priceReview.length>0&&<p className="hh-help">Zero or missing prices must be reviewed before publishing: {preview.priceReview.slice(0,8).join(', ')}.</p>}
        <div className="intake-scroll hh-csv-table"><table><thead><tr><th>SKU</th><th>Card / Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Published</th></tr></thead><tbody>{visibleRows.map(p=><tr key={p.sku}><td>{p.sku}</td><td>{p.productName}</td><td>{p.category}</td><td>${Number(p.salePrice).toFixed(2)}</td><td>{p.quantityOnHand}</td><td>{p.published?'Yes':'No'}</td></tr>)}</tbody></table></div>
        {pageCount>1&&<div className="hh-pages"><button type="button" className="secondary" disabled={previewPage===1} onClick={()=>setPreviewPage(n=>n-1)}>Previous</button><span>Page {previewPage} / {pageCount}</span><button type="button" className="secondary" disabled={previewPage===pageCount} onClick={()=>setPreviewPage(n=>n+1)}>Next</button></div>}
        <div className="hh-intake-buttons"><button type="button" disabled={busy} className="secondary" onClick={artAutofill}>Prepare up to 40 Magic art links</button><button type="button" disabled={busy} onClick={csvDownload}>Download reviewed CSV</button><button type="button" disabled={!inventoryReady||busy} onClick={importToAws}>Save new SKUs to AWS</button></div>
        {!inventoryReady&&<small className="hh-help">AWS import is disabled. Download the reviewed CSV to retain your work until the inventory API is deployed.</small>}
      </>}
    </div>
  </section>;
}
