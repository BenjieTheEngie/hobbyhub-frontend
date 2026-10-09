import React, {useEffect, useState} from "react";
import IntakePanel from "./components/IntakePanel.jsx";
import {SiteHeader,Storefront,ShoppingCart} from "./components/Storefront.jsx";
import {publishedCatalog,safeSavedCart,reconcileCart,setCartQuantity} from "./lib/shop.js";
import {apiProduct,validProduct,uploadImage} from "./lib/intake.js";
import {inventoryForView, isArchived, normalizeInventoryResponse} from "./lib/inventoryStatus.js";
import {productRoute, countSkuMatches, recordChangedOrRemoved, safeRecordLabel} from "./lib/legacyInventory.js";

const API_BASE_URL = "https://13bdy276e1.execute-api.us-east-2.amazonaws.com";
const INVENTORY_API_BASE_URL = String(import.meta.env.VITE_INVENTORY_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || API_BASE_URL).replace(/\/$/, "");
const USE_LEGACY_PRODUCT_ROUTES = !String(import.meta.env.VITE_INVENTORY_API_BASE_URL || "").trim();
const COGNITO_CLIENT_ID = "9qrtgdn5dtoqhc3brmr03mgn0";
const COGNITO_REGION = "us-east-2";


export default function HobbyHubFrontend() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPasswordRecovery, setShowPasswordRecovery] = useState(false);
  const [token, setToken] = useState("");
  useEffect(()=>{
    if(!token)return;
    loadProducts();
    loadDashboard();
  },[token]);
  const [publicStatus,setPublicStatus] = useState("coming-soon");
  const [publicProducts,setPublicProducts] = useState([]);
  const [editingSku,setEditingSku] = useState(null),[editingProductId,setEditingProductId] = useState(null),[stockDrafts,setStockDrafts] = useState({}),[imageBusy,setImageBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [busySku, setBusySku] = useState("");
  const [inventoryNotice, setInventoryNotice] = useState("");
  useEffect(()=>{
    const url=String(import.meta.env.VITE_PUBLIC_CATALOG_URL||"").trim();
    if(!/^https:\/\//.test(url)){setPublicStatus("coming-soon");return;}
    const controller=new AbortController();
    fetch(url,{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw Error("Catalog unavailable");
      return response.json();
    }).then(data=>{
      const list=publishedCatalog(data);
      setPublicProducts(list);
      setPublicStatus("ready");
    }).catch(error=>{if(error.name!=="AbortError")setPublicStatus("coming-soon");});
    return ()=>controller.abort();
  },[]);
  const [dashboard, setDashboard] = useState(null);
  const [products, setProducts] = useState([]);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState("store");
  const [cart, setCart] = useState(()=>{
    try {return safeSavedCart(window.localStorage.getItem("hobbyhub-cart-v2"));}
    catch {return [];}
  });
  const [shopNotice,setShopNotice] = useState("");
  useEffect(()=>{
    try {window.localStorage.setItem("hobbyhub-cart-v2",JSON.stringify(cart.map(item=>({sku:item.sku,cartQuantity:item.cartQuantity}))));}catch {}
  },[cart]);
  useEffect(()=>{
    if(publicStatus==="ready")setCart(current=>reconcileCart(current,publicProducts));
  },[publicStatus,publicProducts]);
  function addToCart(product) {
    if(!product?.quantityOnHand){setShopNotice("That item is currently out of stock.");return;}
    setCart(current=>{
      const match=current.find(item=>item.sku===product.sku);
      if(match)return current.map(item=>item.sku===product.sku?{
        ...product,cartQuantity:Math.min(99,product.quantityOnHand,item.cartQuantity+1)
      }:item);
      return [...current,{...product,cartQuantity:1}];
    });
    setShopNotice(product.productName+" added to your cart. Checkout is not yet open.");
  }
  function changeCartQuantity(sku,quantity){
    setCart(current=>setCartQuantity(current,sku,quantity));
  }
  function removeCartItem(sku){
    setCart(current=>current.filter(item=>item.sku!==sku));
  }
async function removeProduct(product) {
  if (!token || busySku) return;
  const sku=product.sku;
  const path=productRoute(product,USE_LEGACY_PRODUCT_ROUTES);
  if(!path) {setInventoryNotice("Cannot identify this AWS record: productId is unavailable.");return;}
  if(!USE_LEGACY_PRODUCT_ROUTES && countSkuMatches(products,sku)>1) {
    setInventoryNotice("Cannot archive "+sku+" because multiple records share this SKU.");return;
  }
  if(USE_LEGACY_PRODUCT_ROUTES) {
    const warning="Delete ONE AWS record for SKU "+sku+" (ID ends "+safeRecordLabel(product)+")?"+
      "\\n\\nThe legacy DELETE route may PERMANENTLY DELETE this record, rather than archive it."+
      "\\n\\nOther records with this SKU will remain. Type DELETE to confirm:";
    if(window.prompt(warning)!=="DELETE")return;
  } else if(!window.confirm("Archive "+sku+" in AWS and keep its history?"))return;
  setBusySku(USE_LEGACY_PRODUCT_ROUTES?product.productId:sku);
  setInventoryNotice("Submitting request for "+sku+" and verifying the exact record...");
  try{
    await apiProduct(path,token,"DELETE");
    const after=normalizeInventoryResponse(await apiProduct("/products",token));
    if(!recordChangedOrRemoved(product,after,USE_LEGACY_PRODUCT_ROUTES,!USE_LEGACY_PRODUCT_ROUTES))
      throw Error("The requested record is still present without a confirmed archive.");
    setProducts(after);
    if(!after.some(p=>p.sku===sku && !isArchived(p)))setCart(current=>current.filter(item=>item.sku!==sku));
    if(editingProductId===product.productId){setEditingSku(null);setEditingProductId(null);}
    const note=USE_LEGACY_PRODUCT_ROUTES ?
      "Verified one record deleted for "+sku+". "+countSkuMatches(after,sku)+" matching record(s) remain. This was not a reversible archive." :
      "Verified "+sku+" archived in AWS.";
    setInventoryNotice(note);setMessage(note);
  }catch(e){
    const note="No removal confirmed for "+sku+": "+e.message;
    setInventoryNotice(note);setMessage(note);
  }finally{setBusySku("");}
}
async function restoreProduct(product) {
  if(!token || busySku)return;
  if(USE_LEGACY_PRODUCT_ROUTES){setInventoryNotice("Restore is unavailable on the original AWS API. A deleted record may not be recoverable.");return;}
  const sku=product.sku;
  if(countSkuMatches(products,sku)!==1){setInventoryNotice("Duplicate SKU: restoring by SKU is unsafe.");return;}
  if(!window.confirm("Restore SKU "+sku+" as unpublished?"))return;
  setBusySku(sku);
  try{
    await apiProduct(productRoute(product,false),token,"PUT",validProduct({...product,isactive:true,published:false}));
    const after=normalizeInventoryResponse(await apiProduct("/products",token));
    if(!after.some(p=>p.sku===sku && !isArchived(p)))throw Error("AWS did not confirm the restore.");
    setProducts(after);setInventoryNotice("SKU "+sku+" restored. It remains unpublished.");
  }catch(e){setInventoryNotice("Could not restore "+sku+": "+e.message);}
  finally{setBusySku("");}
}
async function updateStock(product,quantity) {
  if(USE_LEGACY_PRODUCT_ROUTES){setInventoryNotice("Stock edits are disabled: stock may reside in the separate Inventory table. Use the verified adjustment API when it is integrated.");return;}
  const sku=product.sku, qty=Number(quantity);
  if(!token||countSkuMatches(products,sku)!==1||!Number.isSafeInteger(qty)||qty<0){setMessage("Requires a unique SKU and nonnegative whole quantity.");return;}
  try{
    await apiProduct(productRoute(product,false),token,"PUT",{...product,quantityOnHand:qty});
    const after=normalizeInventoryResponse(await apiProduct("/products",token));
    if(!after.some(p=>p.sku===sku&&p.quantityOnHand===qty))throw Error("Stock value not confirmed after reload.");
    setProducts(after);setStockDrafts(p=>{const next={...p};delete next[sku];return next;});setMessage("Stock verified in AWS.");
  }catch(e){setMessage("Stock was NOT verified: "+e.message);}
}
  const [productForm, setProductForm] = useState({productName:"",sku:"",category:"Magic: The Gathering",salePrice:0,quantityOnHand:1,reorderPoint:0,imageUrl:"",setCode:"",collectorNumber:"",condition:"Near Mint",finish:"Nonfoil",language:"English",barcode:"",published:false,isactive:true});

  async function login() {
    setMessage("Logging in...");

    const response = await fetch(`https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: COGNITO_CLIENT_ID,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok || data.__type) {
      const code = String(data.__type || data.code || "");
      if (code.includes("PasswordResetRequiredException")) {
        setShowPasswordRecovery(true);
        setPassword("");
        setMessage("Cognito requires a password reset. Use the form under Sign in to request a code.");
      } else {
        setMessage(data.message || "Login failed.");
      }
      return;
    }

    const idToken = data.AuthenticationResult?.IdToken;
    setToken(idToken);
    setMessage("Login successful. Token saved.");
  }

  async function apiRequest(path, options = {}) {
    if (!token) {
      setMessage("Please log in first.");
      return null;
    }

    const baseUrl = path.startsWith("/products") ? INVENTORY_API_BASE_URL : API_BASE_URL;
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setMessage(data.message || "API request failed.");
      return null;
    }

    return data;
  }

  async function loadDashboard() {
    const data = await apiRequest("/dashboard");
    if (data) {
      setDashboard(data);
      setMessage("Dashboard loaded.");
    }
  }

  async function loadProducts() {
    const data = await apiRequest("/products");
    if (data) {
      setProducts(normalizeInventoryResponse(data));
      setMessage("Products loaded.");
    }
  }

  async function createProduct() {
    if(!token){setMessage("Sign in to manage products.");return;}
    try {
      const product=validProduct(productForm);
      if(editingSku && product.sku!==editingSku)throw Error("SKU cannot be changed while editing.");
      if(!editingSku && products.some(p=>p.sku.toLowerCase()===product.sku.toLowerCase()))throw Error("This SKU already exists. Choose a unique SKU.");
      const original=editingSku?products.find(p=>USE_LEGACY_PRODUCT_ROUTES?p.productId===editingProductId:p.sku===editingSku):null;
      if(editingSku && !original)throw Error("Cannot identify the exact record being edited. Reload inventory.");
      const path=original?productRoute(original,USE_LEGACY_PRODUCT_ROUTES):"/products";
      if(!path)throw Error("Missing product API identifier.");
      await apiProduct(path,token,original?"PUT":"POST",product);
      const successMessage=editingSku?"Saved product changes in AWS.":"Created product in AWS.";
      setEditingSku(null);
      setEditingProductId(null);
      setProductForm({productName:"",sku:"",category:"Magic: The Gathering",salePrice:0,quantityOnHand:1,reorderPoint:0,imageUrl:"",setCode:"",collectorNumber:"",condition:"Near Mint",finish:"Nonfoil",language:"English",barcode:"",published:false,isactive:true});
      await loadProducts();
      await loadDashboard();
      setMessage(successMessage);
    } catch(e){setMessage("Product was not saved: "+e.message);}
  }
  async function uploadCurrentImage(file) {
    if(!file)return;
    setImageBusy(true);
    try{const url=await uploadImage(file,token);setProductForm(p=>({...p,imageUrl:url}));setMessage("Image uploaded. Save the product to attach it to inventory.");}
    catch(e){setMessage("Image was not uploaded: "+e.message);}
    finally{setImageBusy(false);}
  }
  function editProduct(item){
    if(USE_LEGACY_PRODUCT_ROUTES && !item.productId){setInventoryNotice("Cannot edit: productId missing.");return;}
    setEditingSku(item.sku);
    setEditingProductId(item.productId||null);
    setProductForm(p=>({...p,...item}));
    setMessage("Editing "+item.sku+". Save changes after reviewing the fields.");
    document.getElementById("product-editor")?.scrollIntoView({behavior:"smooth",block:"start"});
  }
  function updateProductField(field, value) {
    setProductForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-6">
        <SiteHeader page={page} onNavigate={setPage} cartCount={cart.reduce((sum,item)=>sum+item.cartQuantity,0)} />
        {page === "store" && <Storefront products={publicProducts} status={publicStatus} notice={shopNotice} onAddToCart={addToCart} onViewCart={()=>setPage("cart")}/>}
        
{page === "admin" && (
  <>
      <h2 style={{ marginTop: "40px" }}>Admin Tools</h2>
        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow">
            <h2 className="text-xl font-semibold">Login</h2>
            <div className="mt-4 space-y-3">
              <input
                className="w-full rounded-lg border p-3"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
              />
              <input
                className="w-full rounded-lg border p-3"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                type="password"
              />
              {!token?<button className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white" onClick={login}>
                Login with Cognito
              </button>:<button type="button" className="logout-button" onClick={()=>{setToken("");setPassword("");setProducts([]);setDashboard(null);setMessage("Signed out.");}}>Sign out of Admin Tools</button>}
              <button type="button" onClick={() => setShowPasswordRecovery(true)} style={{ background: "#e2e8f0", color: "#1e293b", maxWidth: "100%", whiteSpace: "normal" }}>
                Forgot password / Reset password
              </button>
              {showPasswordRecovery && (
                <PasswordRecovery
                  initialUsername={email}
                  onComplete={(username) => { setEmail(username); setPassword(""); setMessage("Password reset successful. Sign in with your new password."); }}
                  onClose={() => setShowPasswordRecovery(false)}
                />
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow">
            <h2 className="text-xl font-semibold">API Controls</h2>
            <p className="muted">{token?"Signed in. Dashboard and inventory load automatically.":"Sign in to manage your actual AWS inventory."}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white" onClick={loadDashboard}>
                Load Dashboard
              </button>
              <button className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white" onClick={loadProducts}>
                Load Products
              </button>
            </div>
            <p className="mt-4 text-sm text-slate-600">{message}</p>
          </div>
        </section>

        {token && <>
<section className="rounded-2xl bg-white p-6 shadow">
          <h2 className="text-xl font-semibold">Dashboard Metrics</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <Metric label="Suppliers" value={dashboard?.totalSuppliers ?? "--"} />
            <Metric label="Products" value={dashboard?.totalProducts ?? "--"} />
            <Metric label="Low Stock" value={dashboard?.lowStockCount ?? "--"} />
            <Metric label="Pending POs" value={dashboard?.pendingPurchaseOrders ?? "--"} />
          </div>
        </section>

<section className="rounded-2xl bg-white p-6 shadow">
  <h2 className="text-xl font-semibold">Inventory Management</h2>
  <p className="muted">{USE_LEGACY_PRODUCT_ROUTES ? "The original AWS API identifies records by productId. DELETE may permanently delete ONE record, not every item sharing a SKU. Missing stock must be checked separately." : "The upgraded inventory API archives a unique SKU and retains its history."}</p>
  <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
    <button type="button" aria-pressed={!showArchived} onClick={()=>setShowArchived(false)} style={{background:!showArchived?"#173d79":"#e9effa",color:!showArchived?"#fff":"#283f64"}}>
      {USE_LEGACY_PRODUCT_ROUTES?"AWS records":"Active SKUs"} ({inventoryForView(products,false).length})
    </button>
    <button type="button" aria-pressed={showArchived} onClick={()=>setShowArchived(true)} style={{background:showArchived?"#173d79":"#e9effa",color:showArchived?"#fff":"#283f64"}}>
      View archived ({inventoryForView(products,true).length})
    </button>
  </div>
  {inventoryNotice && <p role="status" aria-live="polite" style={{padding:"10px 12px",borderRadius:8,background:"#eef3ff",color:"#243a64",overflowWrap:"anywhere"}}>{inventoryNotice}</p>}
  {USE_LEGACY_PRODUCT_ROUTES && <p className="muted" role="note">Original AWS API active: deletes are potentially permanent. The new soft-archive API is not yet connected. Do not delete a record until you confirm it is a duplicate.</p>}
  {inventoryForView(products,showArchived).length === 0 && <p className="muted">{showArchived?"No archived SKUs were returned by the API.":"No active SKUs were returned by the API."}</p>}

  {inventoryForView(products,showArchived).map((product,index) => (
    <div
      key={product.productId || product.sku+"-"+index}
      style={{
        display: "grid",
        gridTemplateColumns: "2fr 1fr 1fr 1fr",
        gap: "12px",
        alignItems: "center",
        borderBottom: "1px solid #ddd",
        padding: "12px 0"
      }}
    >
      <div>
        <strong>{product.productName}</strong>
        <p style={{ fontSize: "12px", color: "#555" }}>SKU {product.sku} {product.productId && <span>· record {safeRecordLabel(product)}</span>}</p>
        {countSkuMatches(products,product.sku)>1 && <p style={{fontSize:12,fontWeight:700,color:"#9d5b1c"}}>Duplicate SKU — {countSkuMatches(products,product.sku)} distinct records</p>}
        {product.stockReported!==true && <p style={{fontSize:12,color:"#667992"}}>Stock not reported in Products API</p>}
        {product.priceInvalid===true && <p style={{fontSize:12,color:"#af2631"}}>Invalid negative sale price</p>}
        {product.createdAt && <p style={{fontSize:12,color:"#667992"}}>Created: {new Date(product.createdAt).toLocaleString()}</p>}
        <p style={{fontSize:12,color:"#536780"}}>Stored price: {product.priceInvalid ? String(product.rawSalePrice ?? "invalid") : "$"+Number(product.salePrice).toFixed(2)}</p>
      </div>

      <p>{product.category}</p>

      <input
        type="number"
        disabled={USE_LEGACY_PRODUCT_ROUTES || isArchived(product) || Boolean(busySku) || countSkuMatches(products,product.sku)>1}
        aria-label={"Stock for "+product.sku}
        value={product.stockReported===true ? stockDrafts[product.sku] ?? product.quantityOnHand : ""}
        placeholder={product.stockReported===true?"":"Unknown"}
        onBlur={(e) => {if(!USE_LEGACY_PRODUCT_ROUTES && !isArchived(product) && String(product.quantityOnHand)!==e.target.value)updateStock(product,e.target.value);}}
        onChange={(e)=>setStockDrafts(p=>({...p,[product.sku]:e.target.value}))}
        style={{
          padding: "6px",
          border: "1px solid #ccc",
          borderRadius: "6px"
        }}
      />

      <button className="inventory-edit" disabled={isArchived(product) || Boolean(busySku) || (USE_LEGACY_PRODUCT_ROUTES && !product.productId) || (!USE_LEGACY_PRODUCT_ROUTES && countSkuMatches(products,product.sku)>1)} onClick={()=>editProduct(product)}>Edit</button>
      <button
        type="button"
        disabled={Boolean(busySku) || (USE_LEGACY_PRODUCT_ROUTES && !product.productId) || (!USE_LEGACY_PRODUCT_ROUTES && countSkuMatches(products,product.sku)>1)}
        onClick={() => isArchived(product) ? restoreProduct(product) : removeProduct(product)}
        style={{
          background: isArchived(product) ? "#25724d" : "#b42332",
          color: "white",
          border: "none",
          padding: "8px",
          borderRadius: "6px",
          cursor: "pointer"
        }}
      >
        {busySku===(USE_LEGACY_PRODUCT_ROUTES?product.productId:product.sku) ? "Working..." : isArchived(product) ? "Restore SKU" : USE_LEGACY_PRODUCT_ROUTES ? "Delete record" : "Archive SKU"}
      </button>
    </div>
  ))}
</section>

{token && <IntakePanel token={token} products={products} onFill={(data)=>{
  if(data.sku){
    setEditingSku(null);
    setProductForm({productName:"",sku:"",category:"Magic: The Gathering",salePrice:0,quantityOnHand:1,reorderPoint:0,imageUrl:"",setCode:"",collectorNumber:"",condition:"Near Mint",finish:"Nonfoil",language:"English",barcode:"",published:false,isactive:true,...data});
  } else {
    setProductForm(current=>({...current,...data}));
  }
  setMessage("Card information copied. Review its exact printing, SKU, price and condition before saving.");
}} onUpdated={loadProducts}/>} 
        <section className="rounded-2xl bg-white p-6 shadow" id="product-editor">
          <h2 className="text-xl font-semibold">{editingSku?"Edit inventory item":"Add inventory product"}</h2>
          {editingSku&&<button onClick={()=>{setEditingSku(null);setEditingProductId(null);setProductForm({productName:"",sku:"",category:"Magic: The Gathering",salePrice:0,quantityOnHand:1,reorderPoint:0,imageUrl:"",setCode:"",collectorNumber:"",condition:"Near Mint",finish:"Nonfoil",language:"English",barcode:"",published:false,isactive:true});}}>Cancel edit / New product</button>}
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input className="rounded-lg border p-3" value={productForm.productName} onChange={(e) => updateProductField("productName", e.target.value)} placeholder="Product Name" />
            <input className="rounded-lg border p-3" value={productForm.sku} onChange={(e) => updateProductField("sku", e.target.value)} placeholder="SKU" />
            <input className="rounded-lg border p-3" value={productForm.category} onChange={(e) => updateProductField("category", e.target.value)} placeholder="Category" />
            <input className="rounded-lg border p-3" type="number" value={productForm.salePrice} onChange={(e) => updateProductField("salePrice", Number(e.target.value))} placeholder="Sale Price" />
            <input className="rounded-lg border p-3" type="number" value={productForm.quantityOnHand} onChange={(e) => updateProductField("quantityOnHand", Number(e.target.value))} placeholder="Quantity" />
            <input className="rounded-lg border p-3" type="number" value={productForm.reorderPoint} onChange={(e) => updateProductField("reorderPoint", Number(e.target.value))} placeholder="Reorder Point" />
            <input className="rounded-lg border p-3" value={productForm.setCode} onChange={e=>updateProductField("setCode",e.target.value)} placeholder="Set code" />
            <input className="rounded-lg border p-3" value={productForm.collectorNumber} onChange={e=>updateProductField("collectorNumber",e.target.value)} placeholder="Collector number" />
            <input className="rounded-lg border p-3" value={productForm.condition} onChange={e=>updateProductField("condition",e.target.value)} placeholder="Condition" />
            <input className="rounded-lg border p-3" value={productForm.barcode} onChange={e=>updateProductField("barcode",e.target.value)} placeholder="Barcode" />
            <input className="rounded-lg border p-3" value={productForm.imageUrl} onChange={e=>updateProductField("imageUrl",e.target.value)} placeholder="HTTPS image URL" />
            <label className="product-photo-upload">Upload product photo <input type="file" accept="image/jpeg,image/png,image/webp" disabled={imageBusy||!token} onChange={e=>{const file=e.target.files?.[0];e.target.value='';uploadCurrentImage(file);}} />{imageBusy&&<small>Uploading securely…</small>}</label>
            {productForm.imageUrl&&<img className="editor-preview" src={productForm.imageUrl} alt="Product preview" onError={e=>{e.currentTarget.style.display="none";}}/>}
            <label className="publish-label"><input type="checkbox" checked={productForm.published===true} onChange={e=>updateProductField("published",e.target.checked)}/> Publish on storefront</label>
          </div>
           <button className="mt-4 rounded-xl bg-green-600 px-4 py-2 font-semibold text-white" onClick={createProduct} disabled={!token}>
            {editingSku?"Save product changes":"Add product to AWS"}
          </button>
     </section>
      </>}
      </>
    )}
{page === "cart" && <ShoppingCart cart={cart} products={publicProducts} onQuantity={changeCartQuantity} onRemove={removeCartItem} onContinue={()=>setPage("store")}/>}
      </div>
    </main>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-xl border bg-slate-50 p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
    </div>
  );
}


function PasswordRecovery({ initialUsername, onComplete, onClose }) {
  const [username, setUsername] = useState(initialUsername || "");
  const [verificationCode, setVerificationCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [step, setStep] = useState("request");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function cognito(action, input) {
    const response = await fetch("https://cognito-idp." + COGNITO_REGION + ".amazonaws.com/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService." + action,
      },
      body: JSON.stringify({ ClientId: COGNITO_CLIENT_ID, ...input }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.__type) {
      throw new Error(data.message || data.Message || "Cognito request failed. Verify your account recovery settings.");
    }
    return data;
  }

  async function requestCode(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await cognito("ForgotPassword", { Username: username.trim() });
      const destination = data.CodeDeliveryDetails?.Destination;
      setStep("confirm");
      setNotice(destination
        ? "Cognito sent a verification code to " + destination + "."
        : "If recovery is configured for this account, check your verified email or phone for a code.");
    } catch (err) {
      setError(err.message || "Unable to send recovery code.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReset(event) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Your new password must meet the Cognito password policy.");
      return;
    }
    setBusy(true);
    try {
      await cognito("ConfirmForgotPassword", {
        Username: username.trim(),
        ConfirmationCode: verificationCode.trim(),
        Password: newPassword,
      });
      setNewPassword("");
      setConfirmPassword("");
      setVerificationCode("");
      setStep("done");
      setNotice("Password reset successful. Return to sign in with your new password.");
      onComplete?.(username.trim());
    } catch (err) {
      setError(err.message || "Unable to confirm password reset.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 16, padding: 16, border: "1px solid #cbd5e1", borderRadius: 12, maxWidth: "100%", boxSizing: "border-box" }}>
      <h3 style={{ margin: "0 0 8px" }}>Reset Cognito password</h3>
      <p style={{ fontSize: 14, marginBottom: 12 }}>
        Get a code at your verified recovery email or phone, then choose a new password.
      </p>
      {notice && <p role="status" style={{ color: "#166534", fontSize: 14 }}>{notice}</p>}
      {error && <p role="alert" style={{ color: "#991b1b", fontSize: 14 }}>{error}</p>}
      {step !== "done" && (
        <form onSubmit={step === "request" ? requestCode : confirmReset} style={{ display: "grid", gap: 10, maxWidth: 430 }}>
          <label style={{ display: "grid", gap: 4 }}>
            Username or email
            <input required autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} style={{ width: "100%", margin: 0, boxSizing: "border-box" }} />
          </label>
          {step === "confirm" && (
            <>
              <label style={{ display: "grid", gap: 4 }}>
                Verification code
                <input required autoComplete="one-time-code" inputMode="numeric" value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} style={{ width: "100%", margin: 0, boxSizing: "border-box" }} />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                New password
                <input required type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={{ width: "100%", margin: 0, boxSizing: "border-box" }} />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                Confirm new password
                <input required type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={{ width: "100%", margin: 0, boxSizing: "border-box" }} />
              </label>
            </>
          )}
          <button type="submit" disabled={busy}>{busy ? "Please wait..." : step === "request" ? "Send verification code" : "Set new password"}</button>
        </form>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {step === "confirm" && <button type="button" disabled={busy} onClick={requestCode}>Resend code</button>}
        <button type="button" disabled={busy} onClick={onClose}>{step === "done" ? "Back to sign in" : "Close"}</button>
      </div>
    </div>
  );
}
