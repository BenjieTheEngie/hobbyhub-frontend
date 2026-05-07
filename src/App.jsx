import React, { useState } from "react";

const API_BASE_URL = "https://13bdy276e1.execute-api.us-east-2.amazonaws.com";
const COGNITO_CLIENT_ID = "9qrtgdn5dtoqhc3brmr03mgn0";
const COGNITO_REGION = "us-east-2";

const STATIC_PRODUCTS = [
  {
    productName: "Magic Booster Pack",
    sku: "MTG-001",
    category: "Magic: The Gathering",
    salePrice: 5.99,
    quantityOnHand: 50,
    imageUrl: "https://placehold.co/300x400?text=Magic+Booster",
  },
  {
    productName: "Pokémon Elite Trainer Box",
    sku: "PKM-001",
    category: "Pokémon",
    salePrice: 49.99,
    quantityOnHand: 12,
    imageUrl: "https://placehold.co/300x400?text=Pok%C3%A9mon+ETB",
  },
  {
    productName: "Warhammer Starter Set",
    sku: "WH-001",
    category: "Warhammer",
    salePrice: 65.0,
    quantityOnHand: 8,
    imageUrl: "https://placehold.co/300x400?text=Warhammer+Starter",
  },
  {
    productName: "Card Sleeves Pack",
    sku: "ACC-001",
    category: "Accessories",
    salePrice: 9.99,
    quantityOnHand: 100,
    imageUrl: "https://placehold.co/300x400?text=Card+Sleeves",
  },
];

export default function HobbyHubFrontend() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [products, setProducts] = useState([]);
  const [message, setMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const displayProducts = [
  ...STATIC_PRODUCTS,
  ...products.filter(
    (p) =>
      !STATIC_PRODUCTS.some(
        (staticProduct) => staticProduct.sku === p.sku
      )
  )
];
  const categories = ["All", ...new Set(displayProducts.map(p => p.category))];
  const [sortOption, setSortOption] = useState("default");
  const [page, setPage] = useState("store");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [cart, setCart] = useState([]);

  const filteredProducts = displayProducts.filter(product => {
  const matchesSearch = `${product.productName} ${product.sku} ${product.category}`
    .toLowerCase()
    .includes(searchTerm.toLowerCase());

  const matchesCategory =
  selectedCategory === "All" ||
  product.category?.toLowerCase().includes(selectedCategory.toLowerCase());

  return matchesSearch && matchesCategory;
});

const sortedProducts = [...filteredProducts].sort((a, b) => {
  if (sortOption === "price-low") {
    return a.salePrice - b.salePrice;
  }

  if (sortOption === "price-high") {
    return b.salePrice - a.salePrice;
  }

  if (sortOption === "name") {
    return a.productName.localeCompare(b.productName);
  }

  return 0; // default (no sorting)
});
function addToCart(product) {
  setCart((currentCart) => {
    const existingItem = currentCart.find((item) => item.sku === product.sku);

    if (existingItem) {
      return currentCart.map((item) =>
        item.sku === product.sku
          ? { ...item, cartQuantity: item.cartQuantity + 1 }
          : item
      );
    }

    return [...currentCart, { ...product, cartQuantity: 1 }];
  });

  setMessage(`${product.productName} added to cart.`);
}

  const [productForm, setProductForm] = useState({
    productName: "Magic Booster Pack",
    sku: "MTG-001",
    category: "Magic: The Gathering",
    salePrice: 5.99,
    quantityOnHand: 50,
    reorderPoint: 10,
  });

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
      setMessage(data.message || "Login failed.");
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

    const response = await fetch(`${API_BASE_URL}${path}`, {
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
      setProducts(Array.isArray(data) ? data : data.items || []);
      setMessage("Products loaded.");
    }
  }

  async function createProduct() {
    const data = await apiRequest("/products", {
      method: "POST",
      body: JSON.stringify(productForm),
    });

    if (data) {
      setMessage("Product created successfully.");
      await loadDashboard();
      await loadProducts();
    }
  }

  function updateProductField(field, value) {
    setProductForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-2xl bg-white p-6 shadow">
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "20px" }}>
    <div>
      <h1 className="text-3xl font-bold">Hobby Hub</h1>
      <p className="mt-2 text-slate-600">
        Shop cards, tabletop games, and hobby products while managing inventory in one place.
      </p>
    </div>

    <input
  placeholder="Search Magic, Pokémon, Warhammer..."
  value={searchTerm}
  onChange={(e) => setSearchTerm(e.target.value)}
  style={{
    padding: "12px",
    width: "45%",
    borderRadius: "10px",
    border: "1px solid #ccc"
  }}
/>
  </div>
</header>

<div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
  <button onClick={() => setPage("store")}>Storefront</button>
  <button onClick={() => setPage("admin")}>Admin Dashboard</button>

   <button onClick={() => setPage("cart")}>
    Cart ({cart.reduce((total, item) => total + item.cartQuantity, 0)})
  </button>
</div>

{page === "store" && (
  <>
  <section
  style={{
    background: "linear-gradient(135deg, #2563eb, #1e40af)",
    color: "white",
    padding: "32px",
    borderRadius: "16px",
    marginBottom: "24px"
  }}
>
  <h2 style={{ fontSize: "28px", fontWeight: "bold", marginBottom: "10px" }}>
    Shop the Latest Releases
  </h2>

  <p style={{ marginBottom: "16px", color: "#e2e8f0" }}>
    Discover Magic, Pokémon, Warhammer, and more — all in one place.
  </p>

<button
  onClick={() => {
    setPage("store");
    setSelectedProduct(null);
    setSelectedCategory("All");
    setSearchTerm("");

    setTimeout(() => {
      document.getElementById("products-section")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100);
  }}
  style={{
    background: "white",
    color: "#2563eb",
    padding: "10px 16px",
    borderRadius: "8px",
    fontWeight: "600",
    cursor: "pointer"
  }}
>
  Browse Products
</button>
</section>
{selectedProduct && (
  <section className="rounded-2xl bg-white p-6 shadow">
    <button onClick={() => setSelectedProduct(null)}>
      ← Back to Products
    </button>

    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "24px", marginTop: "20px" }}>

      {/* IMAGE */}
      <img
        src={selectedProduct.imageUrl || "https://placehold.co/300x400?text=No+Image"}
        alt={selectedProduct.productName}
        style={{
          width: "100%",
          height: "180px",
          objectFit: "cover",
          borderRadius: "10px",
          marginBottom: "12px"
        }}
      />

      {/* DETAILS */}
      <div>
        <h2>{selectedProduct.productName}</h2>
        <p>{selectedProduct.category}</p>
        <p><strong>SKU:</strong> {selectedProduct.sku}</p>
        <p><strong>Stock:</strong> {selectedProduct.quantityOnHand}</p>
        <h3>${Math.max(0, selectedProduct.salePrice).toFixed(2)}</h3>

        <button onClick={() => addToCart(selectedProduct)}>
         Add to Cart
        </button>
      </div>

    </div>
  </section>
)}
<section className="rounded-2xl bg-white p-6 shadow">
  <h2 className="text-xl font-semibold">Shop by Category</h2>
  
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
      gap: "16px",
      marginTop: "16px"
    }}
  >
    {["All","Magic: The Gathering", "Pokémon", "Warhammer", "Accessories"].map((category) => (
      <div
        key={category}
        onClick={() => setSelectedCategory(category)}
        style={{
          padding: "20px",
          borderRadius: "12px",
          background: "#f8fafc",
          border: "1px solid #e5e7eb",
          fontWeight: "bold",
          textAlign: "center",
          cursor: "pointer"
        }}
      >
        {category}
      </div>
    ))}
  </div>
</section>
<section
  id="products-section"
  className="rounded-2xl bg-white p-6 shadow">
  <h2 className="text-xl font-semibold">Products</h2>
  <select
  value={selectedCategory}
  onChange={(e) => setSelectedCategory(e.target.value)}
  style={{
    marginBottom: "16px",
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid #ccc",
    fontSize: "14px",
    background: "white",
    cursor: "pointer"
  }}
>
  {categories.map((category) => (
    <option key={category} value={category}>
      {category}
    </option>
  ))}
</select>
<select
  value={sortOption}
  onChange={(e) => setSortOption(e.target.value)}
  style={{
    marginLeft: "10px",
    marginBottom: "16px",
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid #ccc",
    fontSize: "14px",
    background: "white",
    cursor: "pointer"
  }}
>
  <option value="default">Sort: Default</option>
  <option value="price-low">Price: Low to High</option>
  <option value="price-high">Price: High to Low</option>
  <option value="name">Name: A to Z</option>
</select>
  <div style={{
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: "20px",
  marginTop: "20px"
}}>
{sortedProducts.map((product, index) => (
<div
  key={index}
  onClick={() => setSelectedProduct(product)}
  style={{
    background: "white",
    padding: "15px",
    borderRadius: "12px",
    boxShadow: "0 4px 10px rgba(0,0,0,0.1)",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
    cursor: "pointer"
   }}
  onMouseEnter={(e) => {
    e.currentTarget.style.transform = "scale(1.03)";
    e.currentTarget.style.boxShadow = "0 8px 20px rgba(0,0,0,0.15)";
  }}
  onMouseLeave={(e) => {
    e.currentTarget.style.transform = "scale(1)";
    e.currentTarget.style.boxShadow = "0 4px 10px rgba(0,0,0,0.1)";
  }}
>
    <h3 style={{ marginBottom: "6px", fontWeight: "bold" }}>
      {product.productName}
    </h3>

    <p style={{ color: "#555" }}>
      {product.category}
    </p>

    <p
      style={{
        fontWeight: "bold",
        marginTop: "10px",
        fontSize: "18px"
      }}
    >
      ${Math.max(0, product.salePrice).toFixed(2)}
    </p>

    <p style={{ fontSize: "12px", color: "#888" }}>
      SKU: {product.sku}
    </p>
  </div>
))}
</div>
          </section>
  </>
)}

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
              <button className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white" onClick={login}>
                Login with Cognito
              </button>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow">
            <h2 className="text-xl font-semibold">API Controls</h2>
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
          <h2 className="text-xl font-semibold">Create Product</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input className="rounded-lg border p-3" value={productForm.productName} onChange={(e) => updateProductField("productName", e.target.value)} placeholder="Product Name" />
            <input className="rounded-lg border p-3" value={productForm.sku} onChange={(e) => updateProductField("sku", e.target.value)} placeholder="SKU" />
            <input className="rounded-lg border p-3" value={productForm.category} onChange={(e) => updateProductField("category", e.target.value)} placeholder="Category" />
            <input className="rounded-lg border p-3" type="number" value={productForm.salePrice} onChange={(e) => updateProductField("salePrice", Number(e.target.value))} placeholder="Sale Price" />
            <input className="rounded-lg border p-3" type="number" value={productForm.quantityOnHand} onChange={(e) => updateProductField("quantityOnHand", Number(e.target.value))} placeholder="Quantity" />
            <input className="rounded-lg border p-3" type="number" value={productForm.reorderPoint} onChange={(e) => updateProductField("reorderPoint", Number(e.target.value))} placeholder="Reorder Point" />
          </div>
           <button className="mt-4 rounded-xl bg-green-600 px-4 py-2 font-semibold text-white" onClick={createProduct}>
            Add Product
          </button>
     </section>
      </>
    )}
{page === "cart" && (
  <>
    <section className="rounded-2xl bg-white p-6 shadow">
      <h2 className="text-xl font-semibold">Shopping Cart</h2>

      {cart.length === 0 ? (
        <p>Your cart is empty.</p>
      ) : (
        <>
          {cart.map((item) => (
            <div
              key={item.sku}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderBottom: "1px solid #ddd",
                padding: "12px 0"
              }}
            >
              <div>
                <strong>{item.productName}</strong>
                <p style={{ fontSize: "12px", color: "#555" }}>
                  {item.category}
                </p>
                <p>
                  <button
  onClick={() =>
    setCart((currentCart) =>
      currentCart.map((i) =>
        i.sku === item.sku
          ? { ...i, cartQuantity: Math.max(1, i.cartQuantity - 1) }
          : i
      )
    )
  }
>
  -
</button>

<span style={{ margin: "0 10px" }}>{item.cartQuantity}</span>

<button
  onClick={() =>
    setCart((currentCart) =>
      currentCart.map((i) =>
        i.sku === item.sku
          ? { ...i, cartQuantity: i.cartQuantity + 1 }
          : i
      )
    )
  }
>
  +
</button>
                </p>
              </div>

              {/* Remove button */}
              <button
                onClick={() =>
                  setCart((currentCart) =>
                    currentCart.filter((i) => i.sku !== item.sku)
                  )
                }
                style={{
                  background: "#ef4444",
                  color: "white",
                  border: "none",
                  padding: "6px 10px",
                  borderRadius: "6px",
                  cursor: "pointer"
                }}
              >
                Remove
              </button>
            </div>
          ))}

          {/* Total */}
          <h3 style={{ marginTop: "20px" }}>
            Total: $
            {cart
              .reduce(
                (total, item) =>
                  total + Math.max(0, item.salePrice) * item.cartQuantity,
                0
              )
              .toFixed(2)}
          </h3>

          {/* Checkout */}
          <button
            onClick={() => {
              setCart([]);
              setMessage("Mock purchase complete.");
            }}
            style={{
              marginTop: "12px",
              background: "#16a34a",
              color: "white",
              padding: "10px 16px",
              borderRadius: "8px",
              cursor: "pointer"
            }}
          >
            Complete Purchase
          </button>
        </>
      )}
    </section>
  </>
)}
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
