import React,{useMemo,useState} from 'react';
import {SHOP_CATEGORIES,shopFilter,shopMoney,reconcileCart} from '../lib/shop.js';
import './storefront.css';

export function SiteHeader({page,onNavigate,cartCount=0}) {
  return (
    <header className="hh-header">
      <div className="hh-topline"><span>HOBBY HUB <span aria-hidden="true">✦</span> YOUR COLLECTOR CORNER</span><span>Trading cards · Tabletop · Retro</span></div>
      <div className="hh-navbar">
        <button type="button" className="hh-logo" onClick={()=>onNavigate('store')} aria-label="Hobby Hub homepage">
          <span className="hh-logo-mark" aria-hidden="true">H</span>
          <span>Hobby<span className="hh-logo-light">Hub</span><small>COLLECT • PLAY • DISCOVER</small></span>
        </button>
        <nav className="hh-nav" aria-label="Primary navigation">
          <button type="button" className={page==='store'?'is-selected':''} aria-current={page==='store'?'page':undefined} onClick={()=>onNavigate('store')}>Shop</button>
          <button type="button" className={page==='admin'?'is-selected':''} aria-current={page==='admin'?'page':undefined} onClick={()=>onNavigate('admin')}>Admin</button>
          <button type="button" className={'hh-cart-nav '+(page==='cart'?'is-selected':'')} aria-current={page==='cart'?'page':undefined} onClick={()=>onNavigate('cart')}><span aria-hidden="true">◫</span> Cart <span className="hh-count">{cartCount}</span></button>
        </nav>
      </div>
    </header>
  );
}

function ProductArtwork({product,large=false}) {
  const [failed,setFailed]=useState(false);
  const hasArt=Boolean(product.imageUrl) && !failed;
  return (
    <div className={'hh-art '+(large?'hh-art-large':'')}>
      {hasArt ? <img src={product.imageUrl} alt={product.productName} loading="lazy" onError={()=>setFailed(true)}/> :
        <div className="hh-art-empty" aria-label="No product photo available">
          <span aria-hidden="true">✦</span><span>{product.category}</span><small>PHOTO COMING SOON</small>
        </div>}
    </div>
  );
}

export function Storefront({products=[],status='coming-soon',onAddToCart,onViewCart,notice,savedSkus=[],onToggleSaved=()=>{}}) {
  const [search,setSearch]=useState('');
  const [category,setCategory]=useState('All');
  const [sort,setSort]=useState('featured');
  const [selected,setSelected]=useState('');
  const [savedOnly,setSavedOnly]=useState(false);
  const [availability,setAvailability]=useState('all');
  const listed=useMemo(()=>shopFilter(products,{search,category,sort,savedSkus,savedOnly,availability}),[products,search,category,sort,savedSkus,savedOnly,availability]);
  const savedListedCount=products.filter(p=>savedSkus.includes(p.sku)).length;
  const selectedProduct=products.find(p=>p.sku===selected);
  const isReady=status==='ready';
  const jumpToCatalog=()=>document.getElementById('products-section')?.scrollIntoView({behavior:'smooth',block:'start'});
  return (
    <div className="hh-shop">
      <section className="hh-hero" aria-label="Hobby Hub introduction">
        <div className="hh-hero-copy">
          <span className="hh-eyebrow"><span className="hh-dot"/> MADE FOR COLLECTORS & PLAYERS</span>
          <h1>Find your next <em>favorite thing.</em></h1>
          <p>Trading cards, tabletop adventures, retro games and the little accessories that make a collection yours.</p>
          <div className="hh-hero-actions">
            <button type="button" onClick={jumpToCatalog} className="hh-primary">Explore the collection <span aria-hidden="true">↗</span></button>
            <span className="hh-hero-note">Independent hobby storefront</span>
          </div>
        </div>
        <div className="hh-hero-graphic" aria-hidden="true">
          <div className="hh-orbit hh-orbit-one"/><div className="hh-orbit hh-orbit-two"/>
          <span className="hh-hero-card hh-card-a">MTG<small>THE GATHERING</small></span>
          <span className="hh-hero-card hh-card-b">PKMN<small>COLLECTIBLES</small></span>
          <span className="hh-hero-card hh-card-c">D20<small>TABLETOP</small></span>
        </div>
      </section>

      <div className="hh-trust-strip" aria-label="Store highlights">
        <span><b aria-hidden="true">✦</b> Curated hobby goods</span>
        <span><b aria-hidden="true">◇</b> Cards, games & collectibles</span>
        <span><b aria-hidden="true">◎</b> Inventory-first listings</span>
      </div>

      <section className="hh-categories" aria-labelledby="hh-category-heading">
        <div className="hh-section-heading"><div><span className="hh-kicker">BROWSE BY INTEREST</span><h2 id="hh-category-heading">Your hobby, your way.</h2></div></div>
        <div className="hh-category-grid">
          {SHOP_CATEGORIES.filter(c=>c!=='All').map((name,index)=>(
            <button type="button" key={name} onClick={()=>{setCategory(name);setSelected('');jumpToCatalog();}} className={'hh-category '+(category===name?'active':'')}>
              <span className="hh-category-icon" aria-hidden="true">{['✧','◈','✳','⚒','▣','⬡'][index]}</span><span>{name}</span><span aria-hidden="true" className="hh-category-arrow">↗</span>
            </button>
          ))}
        </div>
      </section>

      <section className="hh-catalog" id="products-section" aria-labelledby="hh-products-heading">
        <div className="hh-section-heading"><div><span className="hh-kicker">THE COLLECTION</span><h2 id="hh-products-heading">Explore the shelves</h2></div><span className="hh-list-count">{isReady?products.length+' listed item'+(products.length===1?'':'s'):'Catalog in preparation'}</span></div>
        <div className="hh-filters">
          <label className="hh-search-label"><span className="hh-filter-label">Search products</span><span className="hh-search-input"><span aria-hidden="true">⌕</span><input type="search" placeholder="Find a card, set, SKU or game…" value={search} onChange={e=>{setSearch(e.target.value);setSelected('');}} /></span></label>
          <label><span className="hh-filter-label">Category</span><select value={category} onChange={e=>{setCategory(e.target.value);setSelected('');}}>{SHOP_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
          <label><span className="hh-filter-label">Sort by</span><select value={sort} onChange={e=>setSort(e.target.value)}><option value="featured">Featured</option><option value="name">Name: A–Z</option><option value="price-low">Price: Low–High</option><option value="price-high">Price: High–Low</option><option value="new">Recently added</option></select></label>
          <label><span className="hh-filter-label">Availability</span><select value={availability} onChange={e=>setAvailability(e.target.value)}><option value="all">All listings</option><option value="in-stock">In stock only</option></select></label>
          <button type="button" className={'hh-saved-filter '+(savedOnly?'is-on':'')} aria-pressed={savedOnly} onClick={()=>setSavedOnly(v=>!v)}>
            <span aria-hidden="true">{savedOnly?'♥':'♡'}</span> Saved items ({savedListedCount})
          </button>
          {(search||category!=='All'||savedOnly||availability!=='all')&&<button type="button" className="hh-clear" onClick={()=>{setSearch('');setCategory('All');setSavedOnly(false);setAvailability('all');}}>Clear filters</button>}
        </div>
        {notice&&<p className="hh-shop-notice" role="status">{notice}</p>}
        {!isReady ? <div className="hh-empty" role="status">
          <span className="hh-empty-symbol" aria-hidden="true">✦</span>
          <h3>We're stocking the shelves.</h3>
          <p>Our catalog is being connected to live inventory. Have a look around, and check back for the first drops.</p>
          <span className="hh-empty-note">Shopping and checkout are not open yet.</span>
        </div> : listed.length===0 ? <div className="hh-empty" role="status">
          <span className="hh-empty-symbol" aria-hidden="true">⌕</span>
          <h3>No matches this time.</h3>
          <p>{savedOnly?'No saved items match these filters. Save a product with the heart icon, or clear your filters.':'Try another card name, category or search term.'}</p>
          <button type="button" onClick={()=>{setSearch('');setCategory('All');setSavedOnly(false);setAvailability('all');}} className="hh-primary">Show all products</button>
        </div> : <div className="hh-products-grid">
          {listed.map(product=><article className="hh-product" key={product.sku}>
            <button type="button" className={'hh-save-heart '+(savedSkus.includes(product.sku)?'is-saved':'')}
              aria-label={(savedSkus.includes(product.sku)?'Remove from':'Save to')+' saved items: '+product.productName}
              aria-pressed={savedSkus.includes(product.sku)}
              onClick={()=>onToggleSaved(product.sku)}>
              <span aria-hidden="true">{savedSkus.includes(product.sku)?'♥':'♡'}</span>
            </button>
            <button type="button" className="hh-product-art-button" onClick={()=>setSelected(product.sku)} aria-label={'View '+product.productName}><ProductArtwork product={product}/></button>
            <div className="hh-product-info"><span className="hh-product-tag">{product.category}</span>
              <button type="button" className="hh-product-name" onClick={()=>setSelected(product.sku)}>{product.productName}</button>
              <span className="hh-sku">SKU {product.sku}</span>
              <div className="hh-product-bottom"><strong>{shopMoney(product.salePrice)}</strong><span className={'hh-stock '+(product.quantityOnHand>0?'':'hh-out')}>{product.quantityOnHand>0?product.quantityOnHand+' available':'Out of stock'}</span></div>
              <button type="button" className="hh-add" disabled={product.quantityOnHand<1} onClick={()=>onAddToCart(product)}>{product.quantityOnHand<1?'Unavailable':'Add to cart →'}</button>
            </div>
          </article>)}
        </div>}
      </section>

      {selectedProduct && <div className="hh-product-overlay" role="presentation" onClick={()=>setSelected('')}>
        <section className="hh-product-dialog" role="dialog" aria-modal="true" aria-label={selectedProduct.productName} onClick={e=>e.stopPropagation()}>
          <button type="button" className="hh-close" onClick={()=>setSelected('')} aria-label="Close product details">×</button>
          <ProductArtwork product={selectedProduct} large/>
          <div className="hh-detail-copy"><span className="hh-kicker">{selectedProduct.category}</span><h2>{selectedProduct.productName}</h2>
            <p className="hh-sku">SKU {selectedProduct.sku}</p>
            {selectedProduct.setCode&&<p>Set: {selectedProduct.setCode}{selectedProduct.collectorNumber?' · #'+selectedProduct.collectorNumber:''}</p>}
            {selectedProduct.condition&&<p>Condition: {selectedProduct.condition}</p>}
            <p>{selectedProduct.quantityOnHand>0?selectedProduct.quantityOnHand+' in stock':'Currently unavailable'}</p>
            <button type="button" className={'hh-dialog-save '+(savedSkus.includes(selectedProduct.sku)?'is-saved':'')}
              aria-pressed={savedSkus.includes(selectedProduct.sku)}
              onClick={()=>onToggleSaved(selectedProduct.sku)}>
              {savedSkus.includes(selectedProduct.sku)?'♥ Saved to your list':'♡ Save this product'}
            </button>
            <strong className="hh-detail-price">{shopMoney(selectedProduct.salePrice)}</strong>
            <button type="button" className="hh-primary" disabled={!selectedProduct.quantityOnHand} onClick={()=>{onAddToCart(selectedProduct);setSelected('');onViewCart();}}>Add to cart</button>
          </div>
        </section>
      </div>}
      <div className="hh-site-note"><span>HOBBY HUB</span> Built for fans, by fans. Checkout will open after inventory and payment testing are complete.</div>
    </div>
  );
}

export function ShoppingCart({cart=[],products=[],onQuantity,onRemove,onSaveForLater,onContinue}) {
  const actual=reconcileCart(cart,products);
  const total=actual.reduce((sum,item)=>sum+item.salePrice*item.cartQuantity,0);
  const savedMissing=cart.length-actual.length;
  return <section className="hh-cart-page" aria-labelledby="hh-cart-heading">
    <div className="hh-section-heading"><div><span className="hh-kicker">YOUR FINDS</span><h1 id="hh-cart-heading">Shopping cart</h1></div><button type="button" className="hh-clear" onClick={onContinue}>← Continue browsing</button></div>
    <p className="hh-cart-disclaimer">Checkout is not available yet. This cart is a shopping list, not an order or inventory reservation. When checkout launches, Hobby Hub will ship to the 50 U.S. states and Washington, DC only; local pickup and international shipping will not be offered initially.</p>
    {savedMissing>0&&<p className="hh-cart-disclaimer" role="status">{savedMissing} saved item(s) couldn't be confirmed against the current public catalog, so they aren't included in the total.</p>}
    {actual.length===0 ? <div className="hh-empty"><span className="hh-empty-symbol">◇</span><h2>Your cart is waiting for its first find.</h2><p>Discover cards, games and collectibles when live inventory opens.</p><button type="button" className="hh-primary" onClick={onContinue}>Explore the collection</button></div> :
    <div className="hh-cart-layout"><div className="hh-cart-items">{actual.map(item=><article className="hh-cart-item" key={item.sku}><ProductArtwork product={item}/>
      <div className="hh-cart-item-info"><span className="hh-product-tag">{item.category}</span><h2>{item.productName}</h2><span className="hh-sku">SKU {item.sku}</span><div className="hh-cart-row-actions"><button type="button" className="hh-remove" onClick={()=>onRemove(item.sku)}>Remove</button>{onSaveForLater&&<button type="button" className="hh-save-for-later" onClick={()=>onSaveForLater(item.sku)}>♡ Save for later</button>}</div></div>
      <div className="hh-cart-item-aside"><strong>{shopMoney(item.salePrice*item.cartQuantity)}</strong><label>Qty<select value={item.cartQuantity} onChange={e=>onQuantity(item.sku,Number(e.target.value))}>{Array.from({length:Math.min(99,item.quantityOnHand)},(_,i)=>i+1).map(q=><option key={q}>{q}</option>)}</select></label></div>
    </article>)}</div><aside className="hh-cart-summary"><h2>Order preview</h2><div><span>Items</span><span>{actual.reduce((n,i)=>n+i.cartQuantity,0)}</span></div><div><span>Subtotal</span><strong>{shopMoney(total)}</strong></div><p>U.S. delivery only · No local pickup. Shipping rates and applicable taxes will be confirmed before payment. Your total is not final.</p><button type="button" disabled>Checkout coming soon</button><small>No payment is being processed.</small></aside></div>}
  </section>;
}
