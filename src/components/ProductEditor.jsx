import React from 'react';
import {CATEGORIES} from '../lib/intake.js';
import './product-editor.css';

function Field({label,hint,children}) {
  return <label className="hh-pe-field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;
}

export default function ProductEditor({form,editingSku=null,editingProductId=null,isLegacy=true,onChange,onSave,onCancel,onUpload,imageBusy=false,isSignedIn=false}) {
  const update=(field,value)=>onChange(field,value);
  const note=editingSku?'You are editing one existing inventory record.':'This is a new draft. Choose a unique SKU before saving.';
  const alert=Number(form.salePrice)<=0;
  return <section className="hh-pe" id="product-editor" aria-labelledby="hh-pe-title">
    <div className="hh-pe-header"><div><span className="hh-kicker">PRODUCT MASTER / EDITOR</span>
      <h2 id="hh-pe-title">{editingSku?'Edit product record':'Create a product'}</h2>
      <p>{note} {isLegacy?'The legacy API uses productId, and stock is managed separately.':'A published listing must be reviewed before the public catalog is updated.'}</p>
    </div><div className="hh-pe-heading-actions"><span className="hh-pe-state">{editingSku?'EDITING':'NEW DRAFT'}</span>{editingSku&&<button type="button" className="hh-pe-cancel" onClick={onCancel}>Cancel edit</button>}</div></div>
    {editingSku&&<div className="hh-pe-edit-identity">Editing SKU <strong>{editingSku}</strong>{editingProductId&&<span> · AWS productId record selected</span>}</div>}
    <div className="hh-pe-sections">
      <fieldset className="hh-pe-card">
        <legend><span>01</span> Core product details</legend>
        <div className="hh-pe-grid">
          <Field label="Product name" hint="Use the exact sealed product or card printing name."><input required maxLength={200} value={form.productName} onChange={e=>update('productName',e.target.value)} placeholder="e.g. Modern Horizons 3 Play Booster"/></Field>
          <Field label="SKU" hint={editingSku?'Existing SKUs cannot be changed in the editor.':'Unique identifier; do not reuse MTG-001.'}><input required minLength={2} maxLength={80} value={form.sku} readOnly={Boolean(editingSku)} onChange={e=>update('sku',e.target.value)} placeholder="MTG-MH3-BOOSTER"/></Field>
          <Field label="Category"><select value={form.category} onChange={e=>update('category',e.target.value)}>{!CATEGORIES.includes(form.category)&&<option value={form.category}>{form.category}</option>}{CATEGORIES.map(category=><option key={category} value={category}>{category}</option>)}</select></Field>
          <Field label="Sale price (USD)" hint="Confirm against your intended retail price, not an estimated market value."><input type="number" inputMode="decimal" min="0" step="0.01" value={form.salePrice} onChange={e=>update('salePrice',e.target.value)} /></Field>
        </div>
        {alert&&<p className="hh-pe-warning">Price is $0.00 or empty. Review pricing before publishing or selling.</p>}
      </fieldset>

      <fieldset className="hh-pe-card">
        <legend><span>02</span> Trading card attributes</legend>
        <div className="hh-pe-grid">
          <Field label="Set code"><input value={form.setCode||''} onChange={e=>update('setCode',e.target.value)} placeholder="e.g. MH3"/></Field>
          <Field label="Collector number"><input value={form.collectorNumber||''} onChange={e=>update('collectorNumber',e.target.value)} placeholder="e.g. 123"/></Field>
          <Field label="Condition"><select value={form.condition||'Near Mint'} onChange={e=>update('condition',e.target.value)}>{['Near Mint','Lightly Played','Moderately Played','Heavily Played','Damaged','Sealed','New','Used'].map(x=><option key={x}>{x}</option>)}</select></Field>
          <Field label="Finish"><select value={form.finish||'Nonfoil'} onChange={e=>update('finish',e.target.value)}>{['Nonfoil','Foil','Etched','Not Applicable'].map(x=><option key={x}>{x}</option>)}</select></Field>
          <Field label="Language"><input value={form.language||''} onChange={e=>update('language',e.target.value)} placeholder="English"/></Field>
          <Field label="Barcode"><input value={form.barcode||''} onChange={e=>update('barcode',e.target.value)} placeholder="UPC / EAN"/></Field>
        </div>
      </fieldset>

      <fieldset className="hh-pe-card">
        <legend><span>03</span> Stock & catalog media</legend>
        {isLegacy?<div className="hh-pe-warning">The existing AWS Products table does not report stock quantities. The separate Inventory table must be mapped before quantity adjustments are enabled. This editor does not change confirmed warehouse stock.</div>:
          <div className="hh-pe-grid">
            <Field label="Quantity on hand"><input type="number" min="0" step="1" value={form.quantityOnHand} onChange={e=>update('quantityOnHand',Number(e.target.value))}/></Field>
            <Field label="Reorder point"><input type="number" min="0" step="1" value={form.reorderPoint} onChange={e=>update('reorderPoint',Number(e.target.value))}/></Field>
          </div>}
        <div className="hh-pe-grid">
          <Field label="Product image URL" hint="Use a permitted HTTPS image URL; uploads require AWS media setup."><input type="url" value={form.imageUrl||''} onChange={e=>update('imageUrl',e.target.value)} placeholder="https://…"/></Field>
          <label className="hh-pe-upload"><span>Upload image</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={imageBusy||!isSignedIn||!import.meta.env.VITE_MEDIA_API_BASE_URL} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)onUpload(file);}}/><small>{imageBusy?'Uploading…':!import.meta.env.VITE_MEDIA_API_BASE_URL?'AWS media API not connected':'JPG, PNG or WebP'}</small></label>
        </div>
        {form.imageUrl&&<div className="hh-pe-image-preview"><img src={form.imageUrl} alt="Selected product" loading="lazy" onError={e=>{e.currentTarget.style.visibility='hidden';}}/></div>}
      </fieldset>

      <fieldset className="hh-pe-card hh-pe-publish">
        <legend><span>04</span> Publication review</legend>
        <label className="hh-pe-publish-switch"><input type="checkbox" checked={form.published===true} disabled={isLegacy} onChange={e=>update('published',e.target.checked)}/><span><strong>Publish to public storefront</strong><small>{isLegacy?'Legacy records have no verified publication field. Use the upgraded public catalog after migration.':'Uncheck to keep this product private during testing.'}</small></span></label>
        <div className="hh-pe-final-note">No customer checkout is enabled. Price, authenticity, condition and artwork rights must be reviewed manually.</div>
      </fieldset>
    </div>
    <div className="hh-pe-footer"><span>{editingSku?'Changes target the selected product record, not every matching SKU.':'A new product must have a unique SKU.'}</span>
      <button type="button" className="hh-pe-save" disabled={!isSignedIn} onClick={onSave}>{editingSku?'Save record to AWS':'Create product in AWS'}</button>
    </div>
  </section>;
}
