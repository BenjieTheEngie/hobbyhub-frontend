import React, {useEffect, useState} from "react";
import IntakePanel from "./components/IntakePanel.jsx";
import InventoryWorkspace from "./components/InventoryWorkspace.jsx";
import LegacyStockReadPanel from "./components/LegacyStockReadPanel.jsx";
import ProductEditor from "./components/ProductEditor.jsx";
import OrderWorkbench from "./components/OrderWorkbench.jsx";
import {loadOrderOps} from "./lib/orderOps.js";
import {SiteHeader,Storefront,ShoppingCart} from "./components/Storefront.jsx";
import {publishedCatalog,safeSavedCart,reconcileCart,setCartQuantity,safeSavedWishlist,toggleSavedProduct} from "./lib/shop.js";
import {apiProduct,validProduct,uploadImage} from "./lib/intake.js";
import {inventoryForView, isArchived, normalizeInventoryResponse} from "./lib/inventoryStatus.js";
import {productRoute, countSkuMatches, recordChangedOrRemoved, exactLegacyDeletionConfirmed, safeRecordLabel} from "./lib/legacyInventory.js";
import {stockRequest,normalizeStockResponse,mergeVerifiedStock,canEditStock,computeNewStock,ensureAdjustedStockAvailable,verifiedAdjustmentReply} from "./lib/stockV2Client.js";

const API_BASE_URL = "https://13bdy276e1.execute-api.us-east-2.amazonaws.com";
const INVENTORY_API_BASE_URL = String(import.meta.env.VITE_INVENTORY_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || API_BASE_URL).replace(/\/$/, "");
const USE_LEGACY_PRODUCT_ROUTES = !String(import.meta.env.VITE_INVENTORY_API_BASE_URL || "").trim();
const STOCK_V2_API_BASE_URL = String(import.meta.env.VITE_STOCK_API_BASE_URL||"").trim().replace(/\/$/, "");
const ORDER_OPS_API_BASE_URL = String(import.meta.env.VITE_ORDER_OPS_API_BASE_URL||"").trim().replace(/\/$/, "");
const CARRIER_PREVIEW_API_BASE_URL = String(import.meta.env.VITE_CARRIER_PREVIEW_API_BASE_URL||"").trim().replace(/\/$/, "");
const LEGACY_STOCK_READ_API_BASE_URL = String(import.meta.env.VITE_LEGACY_STOCK_READ_API_BASE_URL||"").trim().replace(/\/$/, "");
const ALLOW_STOCK_INITIALIZATION = import.meta.env.VITE_ENABLE_STOCK_INITIALIZATION === "true";
const ALLOW_STOCK_WRITES = import.meta.env.VITE_ENABLE_STOCK_WRITES === "true";
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
    loadOrders();
  },[token]);
  const [publicStatus,setPublicStatus] = useState("coming-soon");
  const [publicProducts,setPublicProducts] = useState([]);
  const [editingSku,setEditingSku] = useState(null),[editingProductId,setEditingProductId] = useState(null),[stockDrafts,setStockDrafts] = useState({}),[imageBusy,setImageBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [busySku, setBusySku] = useState("");
  const [inventoryNotice, setInventoryNotice] = useState("");
  const [stockStatus,setStockStatus] = useState(STOCK_V2_API_BASE_URL?"loading":"unconfigured");
  const [stockBusyId,setStockBusyId] = useState("");
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
  const [orders,setOrders]=useState([]);
  const [ordersStatus,setOrdersStatus]=useState(ORDER_OPS_API_BASE_URL?"loading":"unconfigured");
  const [ordersNotice,setOrdersNotice]=useState("");
  async function loadOrders(){
    if(!ORDER_OPS_API_BASE_URL){setOrdersStatus("unconfigured");return;}
    if(!token){setOrders([]);setOrdersStatus("unconfigured");return;}
    setOrdersStatus("loading");setOrdersNotice("");
    try{
      const next=await loadOrderOps(ORDER_OPS_API_BASE_URL,token);
      setOrders(next);
      setOrdersStatus("ready");
    }catch(e){
      setOrders([]);
      setOrdersStatus("unavailable");
      setOrdersNotice("Order verification failed: "+e.message);
    }
  }
  const [products, setProducts] = useState([]);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState("store");
  const [cart, setCart] = useState(()=>{
    try {return safeSavedCart(window.localStorage.getItem("hobbyhub-cart-v2"));}
    catch {return [];}
  });
  const [shopNotice,setShopNotice] = useState("");
  const [savedSkus,setSavedSkus]=useState(()=>{
    try{return safeSavedWishlist(window.localStorage.getItem("hobbyhub-saved-products-v1"));}catch{return [];}
  });
  useEffect(()=>{
    try{window.localStorage.setItem("hobbyhub-saved-products-v1",JSON.stringify(savedSkus));}catch{}
  },[savedSkus]);
  function toggleWishlist(sku) {setSavedSkus(current=>toggleSavedProduct(current,sku));}
  function saveCartItemForLater(sku) {
    setSavedSkus(current=>current.includes(sku)?current:toggleSavedProduct(current,sku));
    setCart(current=>current.filter(item=>item.sku!==sku));
    setShopNotice("Saved for later in this browser. No order has been placed.");
  }
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
      "\\n\\nOther records with this SKU will remain. This can affect linked inventory or purchase orders."+
      "\\n\\nOnly proceed after backing up and checking related records. Type DELETE to confirm:";
    if(window.prompt(warning)!=="DELETE")return;
  } else if(!window.confirm("Archive "+sku+" in AWS and keep its history?"))return;
  setBusySku(USE_LEGACY_PRODUCT_ROUTES?product.productId:sku);
  setInventoryNotice("Submitting request for "+sku+" and verifying the exact record...");
  try{
    await apiProduct(path,token,"DELETE");
    const after=normalizeInventoryResponse(await apiProduct("/products",token));
    const verified=USE_LEGACY_PRODUCT_ROUTES
      ? exactLegacyDeletionConfirmed(product,products,after)
      : recordChangedOrRemoved(product,after,false,true);
    if(!verified)throw Error("The API response did not verify exactly the expected change. Reload AWS inventory and check this product before trying again.");
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
    if (!data)return {status:"failed",products:[]};
    const base=normalizeInventoryResponse(data);
    if(!STOCK_V2_API_BASE_URL){
      setProducts(base);
      setStockStatus("unconfigured");
      setMessage("Products loaded.");
      return {status:"unconfigured",products:base};
    }
    setStockStatus("loading");
    try{
      const snapshot=normalizeStockResponse(await stockRequest(STOCK_V2_API_BASE_URL,token,"/stock"));
      const merged=mergeVerifiedStock(base,snapshot);
      setProducts(merged);
      setStockStatus("ready");
      setMessage("Products and verified stock loaded.");
      return {status:"ready",products:merged};
    }catch(e){
      setProducts(base.map(p=>({...p,quantityOnHand:0,stockReported:false,stockSource:"unavailable",stockVersion:null})));
      setStockStatus("unavailable");
      setMessage("Products loaded, but stock verification is unavailable: "+e.message);
      return {status:"unavailable",products:base};
    }
  }
  async function changeVerifiedStock(product,{delta,reason,note=""}){
    if(!ALLOW_STOCK_WRITES||!canEditStock(product,stockStatus)||!STOCK_V2_API_BASE_URL)throw Error("Stock writes are disabled until the new API is approved.");
    const after=ensureAdjustedStockAvailable(product,delta);
    const requestId=window.crypto.randomUUID();
    setStockBusyId(product.productId);
    try{
      const response=await stockRequest(STOCK_V2_API_BASE_URL,token,"/stock/"+encodeURIComponent(product.productId)+"/adjust","POST",{
        delta,expectedVersion:product.stockVersion,requestId,reason,note
      });
      if(!verifiedAdjustmentReply(response,requestId,after))throw Error("AWS did not confirm the exact requested adjustment. Refresh before retrying.");
      const refreshed=await loadProducts();
      if(refreshed.status!=="ready")throw Error("AWS acknowledged the change but a fresh stock read failed. Do not submit it again until refreshed.");
      const current=refreshed.products.find(p=>p.productId===product.productId);
      if(!current?.stockReported || current.stockVersion<=product.stockVersion ||
        (current.stockVersion===product.stockVersion+1 && current.quantityOnHand!==after))
        throw Error("Stock changed again or the verified quantity differs. Review the current balance.");
      setInventoryNotice("Verified "+(delta>0?"+":"")+delta+" units for "+product.sku+"; current balance "+current.quantityOnHand+".");
      return current;
    }finally{setStockBusyId("");}
  }
  async function initializeVerifiedStock(product,{onHand,reorderPoint,reason,note=""}){
    if(!ALLOW_STOCK_WRITES||!ALLOW_STOCK_INITIALIZATION||stockStatus!=="ready"||!STOCK_V2_API_BASE_URL||!product?.productId)throw Error("New opening balances are not enabled.");
    if(product.stockReported===true)throw Error("This product already has a verified balance.");
    const requestId=window.crypto.randomUUID();
    setStockBusyId(product.productId);
    try{
      const response=await stockRequest(STOCK_V2_API_BASE_URL,token,"/stock/"+encodeURIComponent(product.productId)+"/initialize","POST",{
        onHand,reorderPoint,requestId,reason,note
      });
      if(!verifiedAdjustmentReply(response,requestId,onHand))throw Error("Opening balance could not be confirmed.");
      const refreshed=await loadProducts();
      const current=refreshed.products.find(p=>p.productId===product.productId);
      if(refreshed.status!=="ready"||!current?.stockReported||current.quantityOnHand!==onHand)
        throw Error("AWS acknowledged initialization but the new count could not be verified. Refresh without retrying.");
      setInventoryNotice("Opening balance verified: "+onHand+" units for "+product.sku+".");
      return current;
    }finally{setStockBusyId("");}
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
  function startNewProduct(){
    setEditingSku(null);setEditingProductId(null);
    setProductForm({productName:"",sku:"",category:"Magic: The Gathering",salePrice:0,quantityOnHand:0,reorderPoint:0,imageUrl:"",setCode:"",collectorNumber:"",condition:"Near Mint",finish:"Nonfoil",language:"English",barcode:"",published:false,isactive:true});
    setMessage("New product draft ready. Review all fields before saving.");
    window.requestAnimationFrame(()=>document.getElementById("product-editor")?.scrollIntoView({behavior:"smooth",block:"start"}));
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
        {page === "store" && <Storefront products={publicProducts} status={publicStatus} notice={shopNotice} onAddToCart={addToCart} onViewCart={()=>setPage("cart")} savedSkus={savedSkus} onToggleSaved={toggleWishlist}/>}
        
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
              </button>:<button type="button" className="logout-button" onClick={()=>{setToken("");setPassword("");setProducts([]);setDashboard(null);setOrders([]);setOrdersStatus("unconfigured");setOrdersNotice("");setStockStatus(STOCK_V2_API_BASE_URL?"loading":"unconfigured");setMessage("Signed out.");}}>Sign out of Admin Tools</button>}
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

<InventoryWorkspace
  products={products}
  isLegacy={USE_LEGACY_PRODUCT_ROUTES}
  onEdit={editProduct}
  onNew={startNewProduct}
  onArchive={removeProduct}
  onRestore={restoreProduct}
  onReload={loadProducts}
  busy={Boolean(busySku)}
  busyId={busySku}
  notice={inventoryNotice}
  editorSku={editingSku}
  stockStatus={stockStatus}
  stockBusyId={stockBusyId}
  stockInitializeEnabled={ALLOW_STOCK_WRITES&&ALLOW_STOCK_INITIALIZATION}
  stockWritesEnabled={ALLOW_STOCK_WRITES}
  onStockAdjust={changeVerifiedStock}
  onStockInitialize={initializeVerifiedStock}
/>
<LegacyStockReadPanel products={products} apiBase={LEGACY_STOCK_READ_API_BASE_URL} token={token}/>

<OrderWorkbench
  orders={orders}
  status={ordersStatus}
  notice={ordersNotice}
  onReload={loadOrders}
  busy={ordersStatus==="loading"}
  carrierPreviewBase={CARRIER_PREVIEW_API_BASE_URL}
  authToken={token}
/>

{token && <IntakePanel token={token} products={products} onFill={(data)=>{
  if(data.sku){
    setEditingSku(null);
    setProductForm({productName:"",sku:"",category:"Magic: The Gathering",salePrice:0,quantityOnHand:1,reorderPoint:0,imageUrl:"",setCode:"",collectorNumber:"",condition:"Near Mint",finish:"Nonfoil",language:"English",barcode:"",published:false,isactive:true,...data});
  } else {
    setProductForm(current=>({...current,...data}));
  }
  setMessage("Card information copied. Review its exact printing, SKU, price and condition before saving.");
}} onUpdated={loadProducts}/>} 
        <ProductEditor
          form={productForm}
          editingSku={editingSku}
          editingProductId={editingProductId}
          isLegacy={USE_LEGACY_PRODUCT_ROUTES}
          isSignedIn={Boolean(token)}
          imageBusy={imageBusy}
          onChange={updateProductField}
          onSave={createProduct}
          onCancel={startNewProduct}
          onUpload={uploadCurrentImage}
        />
      </>}
      </>
    )}
{page === "cart" && <ShoppingCart cart={cart} products={publicProducts} onQuantity={changeCartQuantity} onRemove={removeCartItem} onSaveForLater={saveCartItemForLater} onContinue={()=>setPage("store")}/>}
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
