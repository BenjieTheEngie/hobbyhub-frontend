import React, { useState } from "react";

const API_BASE_URL = "https://13bdy276e1.execute-api.us-east-2.amazonaws.com";
const COGNITO_CLIENT_ID = "9qrtgdn5dtoqhc3brmr03mgn0";
const COGNITO_REGION = "us-east-2";

export default function HobbyHubFrontend() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [products, setProducts] = useState([]);
  const [message, setMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const categories = ["All", ...new Set(products.map(p => p.category))];
  const [sortOption, setSortOption] = useState("default");
  const [page, setPage] = useState("store");

const filteredProducts = products.filter(product => {
  const matchesSearch = `${product.productName} ${product.sku} ${product.category}`
    .toLowerCase()
    .includes(searchTerm.toLowerCase());

  const matchesCategory =
    selectedCategory === "All" || product.category === selectedCategory;

  return matchesSearch && matchesCategory;
});

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
</div>

{page === "store" && (
  <>
<section className="rounded-2xl bg-white p-6 shadow">
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
{filteredProducts.map((product, index) => (
<div
  key={index}
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
