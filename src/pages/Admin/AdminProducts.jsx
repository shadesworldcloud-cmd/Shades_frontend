import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import {
  adjustInventory, getAdminProducts, getCategories, removeProduct, setProductActive,
} from "../../services/api";
import "./AdminProducts.css";
import useConfirmAction from "../../hooks/useConfirmAction";
import ProductWizard from "./ProductWizard";
import { announceCatalogueChanged } from "../../services/catalogueEvents";

const storefrontCategoryNames = ["Men", "Women", "Unisex", "Accessory"];

/**
 * The admin catalogue: the product list, publication controls, quick stock adjustments, and the
 * guided Add/Edit Product wizard (see ProductWizard) that owns everything about a product family —
 * shared fields, Variant 1, additional variants and per-variant photography.
 */
export default function AdminProducts() {
  const { accessToken } = useAuth();
  const confirmAction = useConfirmAction();
  const [products, setProducts] = useState([]); const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true); const [query, setQuery] = useState(""); const [status, setStatus] = useState("all"); const [category, setCategory] = useState("all");
  // null, or { product } — product null means "create". Keyed so reopening resets the wizard.
  const [wizard, setWizard] = useState(null);
  const [selected, setSelected] = useState(null); const [stockInputs, setStockInputs] = useState({});
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");

  const load = useCallback(async () => { setLoading(true); setError(""); try { const [page, list] = await Promise.all([getAdminProducts(accessToken), getCategories()]); setProducts(page.content || []); setCategories((list || []).filter((item) => storefrontCategoryNames.includes(item.categoryName))); } catch (e) { setError(e.message); } finally { setLoading(false); } }, [accessToken]);
  useEffect(() => { load(); }, [load]);
  const filtered = useMemo(() => products.filter((p) => { const term = query.trim().toLowerCase(); return (!term || p.productName?.toLowerCase().includes(term) || p.brand?.toLowerCase().includes(term) || p.variants?.some((v) => v.sku.toLowerCase().includes(term))) && (status === "all" || (status === "active" ? p.isActive : !p.isActive)) && (category === "all" || p.categories?.some((c) => String(c.categoryId) === category)); }), [products, query, status, category]);
  const totalStock = (p) => p.variants?.reduce((sum, v) => sum + Number(v.quantityAvailable || 0), 0) || 0;
  const lowStock = (p) => p.variants?.some((v) => v.isActive && v.quantityAvailable <= v.lowStockThreshold);
  /**
   * The list thumbnail is the family's face: the MAIN VARIANT's main image. Falls back through
   * the main variant's other photos (isPrimary sorts first server-side), then anything at all.
   */
  const primaryImage = (p) => {
    const main = [...(p.variants || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
    const ofMain = (p.images || []).filter((i) => i.variantId == null || i.variantId === main?.variantId);
    return ofMain.find((i) => i.isPrimary) || ofMain[0] || p.images?.[0];
  };

  const openCreate = () => { setError(""); setNotice(""); setSelected(null); setWizard({ product: null }); };
  const openEdit = (product) => { setError(""); setNotice(""); setSelected(null); setWizard({ product }); };
  const wizardSaved = async (message) => { setWizard(null); setNotice(message); await load(); };

  const toggleActive = (product) => { const active = !product.isActive; return confirmAction.ask({
    title: `${active ? "Publish" : "Unpublish"} this product?`,
    body: <p><strong>{product.productName}</strong> will {active ? "become visible in the storefront" : "be hidden from the storefront. Existing orders are unaffected"}.</p>,
    confirmLabel: active ? "Publish" : "Unpublish",
    busyLabel: "Saving…",
    run: async () => { const updated = await setProductActive(accessToken, product.productId, active); setProducts((current) => current.map((p) => p.productId === updated.productId ? updated : p)); announceCatalogueChanged(); },
  }); };
  const remove = (product) => confirmAction.ask({
    title: "Permanently remove this product?",
    body: <p><strong>{product.productName}</strong> will be removed permanently, with its variants and photos. Past orders keep their own records. This cannot be undone.</p>,
    confirmLabel: "Remove permanently",
    busyLabel: "Removing…",
    // The announcement keeps the storefront honest: StoreContext refetches its product list on
    // it, so a product published, hidden or removed here changes the home page — in this tab and
    // any other open shop tab — without a manual refresh.
    run: async () => { await removeProduct(accessToken, product.productId); setProducts((current) => current.filter((p) => p.productId !== product.productId)); announceCatalogueChanged(); },
  });
  const syncSelected = (updated) => { setSelected(updated); setProducts((current) => current.map((p) => p.productId === updated.productId ? updated : p)); };
  const changeStock = async (item) => { const amount = Number(stockInputs[item.variantId] || 0); if (!amount) return; try { await adjustInventory(accessToken, item.variantId, String(amount), "ADJUSTMENT", "Admin product adjustment"); const variants = selected.variants.map((v) => v.variantId === item.variantId ? { ...v, quantityAvailable: v.quantityAvailable + amount } : v); syncSelected({ ...selected, variants }); setStockInputs((c) => ({ ...c, [item.variantId]: "" })); } catch (e) { setError(e.message); } };

  return <section className="products-admin">
    {confirmAction.dialog}
    {error && <div className="admin-alert error">{error}</div>}{notice && <div className="admin-alert success">{notice}</div>}
    <div className="products-toolbar"><p>Create product families: a main product, optional variants, and photos for each.</p><button onClick={openCreate}>+ Add product</button></div>
    <div className="product-admin-stats"><article><span>Displayed products</span><strong>{filtered.length}</strong></article><article><span>Active</span><strong>{filtered.filter((p) => p.isActive).length}</strong></article><article><span>Low stock</span><strong>{filtered.filter(lowStock).length}</strong></article><article><span>Displayed units</span><strong>{filtered.reduce((sum, p) => sum + totalStock(p), 0)}</strong></article></div>
    <div className="product-filters"><input placeholder="Search product, brand or SKU" value={query} onChange={(e) => setQuery(e.target.value)} /><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">All categories</option>{categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.categoryName}</option>)}</select><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
    <div className="product-admin-list">{loading ? <div className="products-empty">Loading catalog…</div> : filtered.length === 0 ? <div className="products-empty"><strong>No products found</strong><span>Add a product or change the filters.</span></div> : filtered.map((product) => <article className="product-admin-row" key={product.productId}><div className="product-admin-thumb">{primaryImage(product) ? <img src={primaryImage(product).imageUrl} alt="" /> : "SW"}</div><div className="product-admin-name"><strong>{product.productName}</strong><small>{product.brand || "No brand"} · {product.categories?.map((c) => c.categoryName).join(", ") || "Uncategorised"}</small></div><div><small>Price</small><strong>₹{Number(product.variants?.[0]?.price ?? product.basePrice).toLocaleString("en-IN")}</strong></div><div><small>Variants</small><strong>{product.variants?.length || 0}</strong></div><div><small>Stock</small><strong className={lowStock(product) ? "stock-low" : ""}>{totalStock(product)}</strong></div><span className={`product-state ${product.isActive ? "active" : "inactive"}`}>{product.isActive ? "Published" : "Draft"}</span><div className="product-row-actions"><button onClick={() => setSelected(product)}>Stock</button><button onClick={() => openEdit(product)}>Edit</button><button onClick={() => toggleActive(product)}>{product.isActive ? "Unpublish" : "Publish"}</button><button className="danger" onClick={() => remove(product)}>Remove</button></div></article>)}</div>

    {wizard && <ProductWizard key={wizard.product?.productId ?? "create"} product={wizard.product}
      categories={categories} accessToken={accessToken}
      onClose={() => setWizard(null)} onSaved={wizardSaved} />}

    {selected && <div className="admin-modal-backdrop" onMouseDown={() => setSelected(null)}><div className="admin-product-modal manage-modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-heading"><div><span>Inventory</span><h2>{selected.productName}</h2></div><button onClick={() => setSelected(null)}>×</button></div>
      <section><h3>Variants & inventory</h3>
        <p className="image-count">Variant details, photos and archiving live in Edit — this dialog is for quick stock corrections.</p>
        <div className="variant-list">{selected.variants?.map((v) => <div className="variant-item" key={v.variantId}><div><strong>{v.variantName || v.sku} {v.attributes?.color && `· ${v.attributes.color}`}{v.mainVariant && <em className="pw-main-badge"> Main</em>}{v.isActive === false && <em className="pw-archived-badge"> Archived</em>}</strong><small>{v.sku} · ₹{v.price} · {v.quantityAvailable} units</small></div><div className="stock-adjust"><input type="number" placeholder="± qty" value={stockInputs[v.variantId] || ""} onChange={(e) => setStockInputs((c) => ({ ...c, [v.variantId]: e.target.value }))} /><button onClick={() => changeStock(v)}>Adjust</button></div></div>)}</div>
      </section></div></div>}
  </section>;
}
