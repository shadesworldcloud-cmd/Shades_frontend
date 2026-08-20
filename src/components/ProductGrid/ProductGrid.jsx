import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  // The Refine panel hangs off an icon in the navbar, so it renders through a portal into the slot
  // Navbar leaves for it. Two open modes: "hover" follows the pointer and closes when it leaves,
  // "pinned" survives until Escape, an outside click, or a second click on the icon — and pinning
  // is the only mode a touch device can reach, since it has no hover.
  const [navSlot, setNavSlot] = useState(null);
  const [menuMode, setMenuMode] = useState("closed");
  const menuModeRef = useRef("closed");
  const closeTimer = useRef(0);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const menuOpen = menuMode !== "closed";
  const setMode = (mode) => { menuModeRef.current = mode; setMenuMode(mode); };

  // Is something inside the panel focused BY KEYBOARD? :focus-visible is the browser's own answer
  // to that question, and the distinction matters: an earlier version refused to close whenever the
  // panel merely contained document.activeElement, which meant that once a mouse user clicked a
  // select the panel never closed again on pointer-out. Keyboard users still need it held open.
  const holdsKeyboardFocus = () => {
    if (!menuRef.current) return false;
    try { return Boolean(menuRef.current.querySelector(":focus-visible")); }
    catch (unsupported) { return menuRef.current.contains(document.activeElement); }
  };

  const revealMenu = () => {
    window.clearTimeout(closeTimer.current);
    if (menuModeRef.current !== "pinned") setMode("hover");
  };
  const dismissMenu = () => {
    window.clearTimeout(closeTimer.current);
    // Deliberately delayed. A native <select> puts its dropdown outside the panel's box while it is
    // open, so an immediate close on mouseleave would snatch the panel away mid-choice; the same
    // grace period forgives cutting the corner between the icon and the panel below it.
    closeTimer.current = window.setTimeout(() => {
      if (menuModeRef.current === "pinned") return;
      if (holdsKeyboardFocus()) return;
      closeMenu();
    }, 220);
  };
  // Closing while a control inside still holds focus would strand the focus ring in a subtree that
  // is about to be `hidden`, which loses a screen reader's place entirely. Hand it back to the icon.
  // useCallback because the Escape/outside-click effect depends on it: an unstable identity would
  // tear down and re-bind both document listeners on every render.
  const closeMenu = useCallback(() => {
    if (menuRef.current && menuRef.current.contains(document.activeElement)) {
      triggerRef.current?.focus();
    }
    menuModeRef.current = "closed";
    setMenuMode("closed");
  }, []);

  useEffect(() => { setNavSlot(document.getElementById("nav-filter-slot")); }, []);
  const renderMenu = (menu) => (navSlot ? createPortal(menu, navSlot) : menu);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => { if (event.key === "Escape") closeMenu(); };
    const onPointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) closeMenu();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [closeMenu, menuOpen]);

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
          <select aria-label="Sort products" value={sort} onChange={(event) => setFilter("sort", event.target.value, "featured")}><option value="featured">Featured</option><option value="newest">Newest</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="name">Name A–Z</option></select>
        </div>
        {/* Rendered into the navbar slot when there is one, and in place when there is not. The
            fallback is not decoration: without it a missing slot — a page that does not draw the
            navbar, a renamed id, a unit test mounting this component alone — would silently delete
            every filter control rather than fail loudly, which is how a regression ships unnoticed. */}
        {renderMenu(
          <div className="nav-filter" ref={menuRef} onMouseEnter={revealMenu} onMouseLeave={dismissMenu}>
            <button
              type="button"
              ref={triggerRef}
              className={`nav-filter-trigger ${menuOpen ? "open" : ""}`}
              /* Accessible name starts with "Filters" so it reads the same to a screen reader as
                 the button this replaces, and stays findable by name in the E2E suite. */
              aria-label={`Filters${activeFilters ? `, ${activeFilters} active` : ""}`}
              aria-expanded={menuOpen}
              aria-controls="product-filters"
              onClick={() => (menuMode === "pinned" ? closeMenu() : setMode("pinned"))}
              onFocus={revealMenu}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M4 7h16M7 12h10M10 17h4" />
              </svg>
              {activeFilters > 0 && <span className="nav-filter-count">{activeFilters}</span>}
            </button>
            <div id="product-filters" className="nav-filter-panel" role="group" aria-label="Refine collection" hidden={!menuOpen}>
              <header><strong>Refine collection</strong>{activeFilters > 0 && <button type="button" onClick={reset}>Clear all</button>}</header>
              <label>Brand<select value={brand} onChange={(event) => setFilter("brand", event.target.value, "All")}>{brands.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label>Color<select value={color} onChange={(event) => setFilter("color", event.target.value, "All")}>{colors.map((value) => <option key={value}>{value}</option>)}</select></label>
              <fieldset><legend>Price range</legend><div><label>Minimum<input type="number" min="0" value={minPrice} onChange={(event) => setFilter("minPrice", event.target.value)} placeholder="₹ 0" /></label><label>Maximum<input type="number" min="0" value={maxPrice} onChange={(event) => setFilter("maxPrice", event.target.value)} placeholder="Any" /></label></div></fieldset>
              <label className="stock-filter"><input type="checkbox" checked={availability === "in-stock"} onChange={(event) => setFilter("availability", event.target.checked ? "in-stock" : "", "all")} /> In-stock styles only</label>
            </div>
          </div>
        )}
        {/* Kept OUT of the panel on purpose. The panel is `hidden` whenever it is closed, and an
            alert inside a hidden subtree is never announced and never seen — the shopper would get
            an empty grid with the explanation sealed behind an icon. It belongs with the results it
            explains. */}
        {invalidPriceRange && <p className="filter-error" role="alert">Minimum price cannot exceed maximum price.</p>}
        <div className="discovery-layout">
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
