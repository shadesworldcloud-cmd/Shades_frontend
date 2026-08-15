import React, { useContext, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import "./ProductGrid.css";
import { StoreContext, listingPrice } from "../../context/StoreContext";
import ProductCard from "../ProductCard/ProductCard";

const text = (value) => String(value || "").trim().toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
// Sorting orders the numbers on screen, so it must use the price each card prints \u2014 not `price`,
// which is the product-level minimum and belongs to a colourway the card may not be selling. The
// two diverge the moment the cheapest variant goes out of stock.
const cardPrice = (item) => listingPrice(item.defaultVariantPrice, item.price);
const SORTS = new Set(["featured", "newest", "price-low", "price-high", "name"]);
const PAGE_SIZE = 12;

const ProductGrid = ({ category }) => {
  const { product_list, productsLoading, productsError, refreshProducts } = useContext(StoreContext);
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const query = params.get("q") || "";
  const brand = params.get("brand") || "All";
  const color = params.get("color") || "All";
  const availability = params.get("availability") === "in-stock" ? "in-stock" : "all";
  const requestedSort = params.get("sort") || "featured";
  const sort = SORTS.has(requestedSort) ? requestedSort : "featured";
  const minPrice = params.get("minPrice") || "";
  const maxPrice = params.get("maxPrice") || "";

  const setFilter = (name, value, defaultValue = "") => {
    const next = new URLSearchParams(params);
    if (!value || value === defaultValue) next.delete(name);
    else next.set(name, value);
    // Any filter or sort change invalidates the page number: narrowing the results would
    // otherwise strand the shopper on a page that no longer exists.
    if (name !== "page") next.delete("page");
    setParams(next, { replace: true });
  };
  const reset = () => setParams(new URLSearchParams(), { replace: true });

  const brands = useMemo(
    () => ["All", ...new Set(product_list.map((item) => item.brand).filter(Boolean))].sort(),
    [product_list]
  );
  const colors = useMemo(
    () => ["All", ...new Set(product_list.flatMap((item) => item.variants || []).map((variant) => variant.attributes?.color || variant.variantName).filter(Boolean))].sort(),
    [product_list]
  );
  const filtered = useMemo(() => {
    const terms = text(query).split(/\s+/).filter(Boolean);
    const parsedLow = minPrice === "" ? null : Number(minPrice);
    const parsedHigh = maxPrice === "" ? null : Number(maxPrice);
    const low = Number.isFinite(parsedLow) && parsedLow >= 0 ? parsedLow : null;
    const high = Number.isFinite(parsedHigh) && parsedHigh >= 0 ? parsedHigh : null;
    if (low !== null && high !== null && low > high) return [];
    return product_list.filter((item) => {
      const searchable = [item.name, item.brand, item.description, ...item.categories.map((entry) => entry.categoryName), ...item.variants.flatMap((variant) => [variant.variantName, variant.sku, ...Object.values(variant.attributes || {})])].map(text).join(" ");
      const productColors = item.variants.map((variant) => text(variant.attributes?.color || variant.variantName));
      return (category === "All" || item.categories.some((entry) => entry.categoryName === category))
        && (terms.length === 0 || terms.every((term) => searchable.includes(term))) && (brand === "All" || item.brand === brand)
        && (color === "All" || productColors.includes(text(color)))
        && (availability !== "in-stock" || item.available)
        && (low === null || item.price >= low) && (high === null || item.price <= high);
    }).sort((a, b) => {
      if (sort === "price-low") return cardPrice(a) - cardPrice(b);
      if (sort === "price-high") return cardPrice(b) - cardPrice(a);
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "newest") return Number(b.isNew) - Number(a.isNew) || Number(b.productId) - Number(a.productId);
      return Number(b.available) - Number(a.available) || Number(b.productId) - Number(a.productId);
    });
  }, [availability, brand, category, color, maxPrice, minPrice, product_list, query, sort]);
  // Pagination is client-side on purpose: product_list is one global cache that Cart, PlaceOrder,
  // ProductDetail and Wishlist all need to be complete, so it cannot be fetched a page at a time.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const requestedPage = Number.parseInt(params.get("page") || "1", 10);
  // An out-of-range or junk ?page lands on the nearest real page instead of an empty grid.
  const page = Number.isFinite(requestedPage) ? Math.min(Math.max(requestedPage, 1), totalPages) : 1;
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const goToPage = (next) => setFilter("page", next <= 1 ? "" : String(next));
  const invalidPriceRange = minPrice !== "" && maxPrice !== "" && Number(minPrice) > Number(maxPrice);
  const activeFilters = [query, brand !== "All", color !== "All", availability !== "all", minPrice, maxPrice, category !== "All"].filter(Boolean).length;

  return (
    <section className="product-grid">
      <div className="container">
        <div className="discovery-bar">
          <div><span>Product discovery</span><strong aria-live="polite">{productsLoading ? "Loading…" : `${filtered.length} style${filtered.length === 1 ? "" : "s"}`}</strong></div>
          <label className="discovery-search"><span aria-hidden="true">⌕</span><input aria-label="Search products" value={query} onChange={(event) => setFilter("q", event.target.value)} placeholder="Search frames, brands, colors or SKU" /></label>
          <button type="button" className="filter-toggle" aria-expanded={filtersOpen} aria-controls="product-filters" onClick={() => setFiltersOpen((value) => !value)}>Filters{activeFilters ? ` (${activeFilters})` : ""}</button>
          <select aria-label="Sort products" value={sort} onChange={(event) => setFilter("sort", event.target.value, "featured")}><option value="featured">Featured</option><option value="newest">Newest</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="name">Name A–Z</option></select>
        </div>
        <div className={`discovery-layout ${filtersOpen ? "filters-open" : ""}`}>
          <aside id="product-filters" className="discovery-filters">
            <header><strong>Refine collection</strong>{activeFilters > 0 && <button type="button" onClick={reset}>Clear all</button>}</header>
            <label>Brand<select value={brand} onChange={(event) => setFilter("brand", event.target.value, "All")}>{brands.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Color<select value={color} onChange={(event) => setFilter("color", event.target.value, "All")}>{colors.map((value) => <option key={value}>{value}</option>)}</select></label>
            <fieldset><legend>Price range</legend><div><label>Minimum<input type="number" min="0" value={minPrice} onChange={(event) => setFilter("minPrice", event.target.value)} placeholder="₹ 0" /></label><label>Maximum<input type="number" min="0" value={maxPrice} onChange={(event) => setFilter("maxPrice", event.target.value)} placeholder="Any" /></label></div></fieldset>
            <label className="stock-filter"><input type="checkbox" checked={availability === "in-stock"} onChange={(event) => setFilter("availability", event.target.checked ? "in-stock" : "", "all")} /> In-stock styles only</label>
            {invalidPriceRange && <p className="filter-error" role="alert">Minimum price cannot exceed maximum price.</p>}
          </aside>
          <div className="discovery-results">
            <div className="product-grid-list">{!productsLoading && !productsError && visible.map((item) => <ProductCard key={item._id} id={item._id} slug={item.slug} name={item.name} price={item.price} variantPrice={item.defaultVariantPrice} priceFrom={item.priceFrom} image={item.defaultVariantImage || item.image} color={item.color} isNew={item.isNew} variantId={item.defaultVariantId} stock={item.defaultVariantStock} available={item.available} />)}</div>
            {/* Hidden at a single page: a lone "1" control is noise, not navigation. */}
            {!productsLoading && !productsError && totalPages > 1 && <nav className="product-pagination" aria-label="Product pages">
              <button type="button" disabled={page <= 1} onClick={() => goToPage(page - 1)}>← Previous</button>
              <ul>{Array.from({ length: totalPages }, (unused, index) => index + 1).map((number) => <li key={number}>
                <button type="button" className={number === page ? "current" : ""}
                  aria-current={number === page ? "page" : undefined}
                  aria-label={`Page ${number} of ${totalPages}`} onClick={() => goToPage(number)}>{number}</button>
              </li>)}</ul>
              <button type="button" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>Next →</button>
            </nav>}
            {productsLoading && <p className="no-products">Loading the collection…</p>}
            {productsError && <div className="no-products products-error" role="alert">
              <p>The collection could not be loaded. Please try again shortly.</p>
              <button type="button" onClick={refreshProducts}>Try again</button>
            </div>}
            {!productsLoading && !productsError && filtered.length === 0 && <div className="discovery-empty"><span>SW</span><h3>No matching styles</h3><p>{invalidPriceRange ? "Correct the price range to continue." : "Try removing a filter or searching with broader terms."}</p><button type="button" onClick={reset}>Reset discovery</button></div>}
          </div>
        </div>
      </div>
    </section>
  );
};
export default ProductGrid;
