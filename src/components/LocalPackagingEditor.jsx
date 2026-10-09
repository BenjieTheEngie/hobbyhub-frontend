import React,{useState} from 'react';
import {measuredPackagingProfile} from '../lib/packagingWorksheet.js';
import {validateLocalPackageDraft} from '../lib/localPackaging.js';

export default function LocalPackagingEditor({product,localDraft,onSave,onClear}) {
  const existing=measuredPackagingProfile(product);
  const saved=localDraft?.shippingPackage||null;
  const source=saved||product?.shippingPackage||{};
  const [values,setValues]=useState({
    lengthIn:String(source.lengthIn??''),
    widthIn:String(source.widthIn??''),
    heightIn:String(source.heightIn??''),
    weightOz:String(source.weightOz??''),
    note:localDraft?.note||''
  });
  const [feedback,setFeedback]=useState('');
  const localHasDraft=Boolean(saved);
  function setField(field,value){setValues(s=>({...s,[field]:value}));setFeedback('');}
  function submit(e){
    e.preventDefault();setFeedback('');
    try{
      if(!product?.productId)throw Error('This product lacks an immutable productId. No packaging can be saved.');
      const record=validateLocalPackageDraft(values);
      onSave(product.productId,record);
      setFeedback('Measurements saved in this browser only. Export the packaging CSV for a portable backup.');
    }catch(err){setFeedback('Not saved: '+err.message);}
  }
  function clearLocal(){
    if(!localHasDraft)return;
    if(!window.confirm('Remove the measurements saved only in this browser for this productId? AWS products will not be changed.'))return;
    try {onClear(product.productId);setFeedback('Browser-only packaging values cleared. AWS was not changed.');}
    catch(err){setFeedback('Not cleared: '+err.message);}
  }
  return <section className="hh-packaging-editor" aria-label="Packed shipping measurements">
    <div className="hh-packaging-heading">
      <strong>Shipping parcel measurements</strong>
      <span>{existing?'Stored with product':localHasDraft?'Saved on this device':'Not measured'}</span>
    </div>
    <p>Measure this product <b>already in its protective mailing package</b>. Inches and ounces, including padding. Values saved here stay in your browser; they are not synced to AWS or available to live checkout.</p>
    <form onSubmit={submit}>
      <div className="hh-packaging-fields">
        {[['lengthIn','Packed length (in)'],['widthIn','Width (in)'],['heightIn','Height (in)'],['weightOz','Total weight (oz)']].map(([field,title])=>
          <label key={field}>{title}<input type="number" inputMode="decimal" min="0.1" max={field==='weightOz'?1120:48} step="0.1" required
            value={values[field]} onChange={e=>setField(field,e.target.value)} placeholder="Measure"/></label>)}
      </div>
      <label className="hh-packaging-notes">Packaging notes (optional)
        <input maxLength={180} value={values.note} onChange={e=>setField('note',e.target.value)}
          placeholder="e.g. rigid mailer + sleeve + padding"/></label>
      <div className="hh-packaging-actions">
        <button type="submit" className="inv-button inv-button-primary" disabled={!product?.productId}>Save on this device</button>
        {localHasDraft&&<button type="button" className="inv-button inv-button-outline" onClick={clearLocal}>Clear local measurements</button>}
      </div>
    </form>
    {feedback&&<p className="inv-feedback" role="status">{feedback}</p>}
  </section>;
}
