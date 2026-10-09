import React,{useState} from 'react';
import {fetchCarrierRatePreview} from '../lib/carrierRateClient.js';
import {centsUsd} from '../lib/orderOps.js';

/** No customer data is stored; use only made-up/test destinations in sandbox. */
export default function CarrierRatePreview({baseUrl='',token=''}) {
  const enabled=Boolean(baseUrl&&token);
  const [destination,setDestination]=useState({recipient:'',line1:'',city:'',state:'',postalCode:'',country:'US'});
  const [packageInput,setPackageInput]=useState({lengthIn:'',widthIn:'',heightIn:'',weightOz:''});
  const [options,setOptions]=useState([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  function changeDestination(key,value){setDestination(s=>({...s,[key]:value}));setOptions([]);}
  function changeParcel(key,value){setPackageInput(s=>({...s,[key]:value}));setOptions([]);}
  async function submit(e){
    e.preventDefault();if(!enabled||busy)return;
    setBusy(true);setMessage('');setOptions([]);
    try {
      const parcel=Object.fromEntries(Object.entries(packageInput).map(([k,v])=>[k,Number(v)]));
      if(Object.values(packageInput).some(v=>!v.trim()) ||
          Object.values(parcel).some(v=>!Number.isFinite(v)||v<=0))
        throw Error('Enter actual packed dimensions in inches and weight in ounces.');
      const rows=await fetchCarrierRatePreview(baseUrl,token,{destination,parcel});
      if(!rows.length)throw Error('No valid test rates were returned.');
      setOptions(rows);
      setMessage('Test-only carrier rates received. No label or payment has been purchased.');
    }catch(err){
      setMessage(err?.message||'Carrier test quote is unavailable.');
    }finally{setBusy(false);}
  }
  return <section className="hh-rate-preview" aria-labelledby="hh-rate-preview-title">
    <div className="hh-rate-preview-head">
      <span className="hh-orders-eyebrow">SHIPPING / SANDBOX</span>
      <h3 id="hh-rate-preview-title">Carrier-calculated rate preview</h3>
      <p>Compare test USPS, UPS or FedEx shipping quotes using measured package size, packed weight, and a U.S. destination. Quotes are informational—not checkout totals or actual postage.</p>
    </div>
    {!enabled ? <div className="hh-orders-readonly" role="status">
      Carrier test-rate preview is not connected. AWS sandbox deployment and an EasyPost test account are needed first. No rates are estimated or invented.
    </div> : <form onSubmit={submit}>
      <fieldset><legend>Test destination (do not enter real customer data)</legend>
        <div className="hh-rate-fields">
          <label>Recipient<input required maxLength={120} value={destination.recipient} onChange={e=>changeDestination('recipient',e.target.value)} placeholder="Test recipient"/></label>
          <label>Street<input required maxLength={160} value={destination.line1} onChange={e=>changeDestination('line1',e.target.value)} placeholder="Test street address"/></label>
          <label>City<input required maxLength={100} value={destination.city} onChange={e=>changeDestination('city',e.target.value)}/></label>
          <label>State (2-letter)<input required maxLength={2} value={destination.state} onChange={e=>changeDestination('state',e.target.value.toUpperCase())} placeholder="MA"/></label>
          <label>ZIP code<input required inputMode="numeric" maxLength={10} value={destination.postalCode} onChange={e=>changeDestination('postalCode',e.target.value)} placeholder="5-digit ZIP"/></label>
        </div>
      </fieldset>
      <fieldset><legend>Merchant-measured packed parcel</legend>
        <div className="hh-rate-fields">
          {[['lengthIn','Length (in)'],['widthIn','Width (in)'],['heightIn','Height (in)'],['weightOz','Packed weight (oz)']].map(([key,label])=>
            <label key={key}>{label}<input required type="number" min="0.1" max={key==='weightOz'?'1120':'48'} step="0.1"
              value={packageInput[key]} onChange={e=>changeParcel(key,e.target.value)}/></label>)}
        </div>
      </fieldset>
      <button type="submit" className="hh-rate-submit" disabled={busy}>{busy?'Checking test rates…':'Request test carrier rates'}</button>
    </form>}
    {message&&<p className="hh-orders-message" role="status">{message}</p>}
    {options.length>0&&<div className="hh-rate-options" aria-label="Carrier test rates">
      <strong>Test rates · never final shipping charges</strong>
      {options.map((o,i)=><div className="hh-rate-option" key={o.rateId||i}>
        <span><b>{o.carrier}</b> · {o.service}</span>
        <strong>{centsUsd(o.shippingCents)}</strong>
        <small>{o.deliveryDays==null?'No verified delivery estimate':'Provider estimate: '+o.deliveryDays+' days'} · Test only</small>
      </div>)}
    </div>}
    <p className="hh-rate-footer">Only merchant-approved measured packages may be rated. Multi-item packaging, production rates, tax and actual postage purchase remain separate launch tasks.</p>
  </section>;
}
