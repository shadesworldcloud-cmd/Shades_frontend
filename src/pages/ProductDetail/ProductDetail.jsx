import React, { useContext, useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import "./ProductDetail.css";
import { StoreContext, galleryFor, imageForVariant, isBorrowedImage, mapProduct, productPath, selectDefaultVariant, variantLabel } from "../../context/StoreContext";
import ProductReviews from "../../components/ProductReviews/ProductReviews";
import ProductGallery from "../../components/ProductGallery/ProductGallery";
import { getProductBySlug, getCanonicalProductSlug } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

/** A path segment that is only digits is a legacy /product/{PRODUCT_ID} link, not a slug. */
const isLegacyNumericId = (segment) => /^\d+$/.test(segment || "");

export default function ProductDetail() {
  const { slug } = useParams();
  const { product_list, cartItems, addToCart, isWishlisted, toggleWishlist } = useContext(StoreContext);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // The product now comes from the server, addressed by the slug in the URL.
  //
  // It used to be `product_list.find((item) => item._id === id)` — a lookup in the storefront's
  // cached listing, which is fetched as `?size=200`. Any product outside that first page therefore
  // rendered "Product not found" on a direct hit, refresh or shared link, while working perfectly
  // if you arrived by clicking a card. Measured against the 1,182-product test catalogue, that was
  // most of the shop. Fetching the one product in the URL removes the dependency on the listing
  // entirely, which is also what makes refresh and Back/Forward correct.
  const [product, setProduct] = useState(null);
  const [productsLoading, setProductsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("description");
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [wishlistError, setWishlistError] = useState("");
  // The deep link carries the variant's family POSITION (?variant=2), never its sequential
  // database id — public URLs stopped publishing internal ids when the slug replaced the product
  // id, and the variant id would reopen the same hole. Old id-carrying links simply fail to match
  // a position and fall back to the default-selection rule.
  const requestedPosition = params.get("variant");

  useEffect(() => {
    let active = true;
    setProductsLoading(true);

    // A legacy numeric link is redirected to the canonical slug rather than rendered. `replace`,
    // so Back returns to wherever the customer came from instead of bouncing them through the old
    // URL again — and so the numeric form never becomes the page's canonical address.
    if (isLegacyNumericId(slug)) {
      getCanonicalProductSlug(slug)
        .then((response) => {
          if (!active) return;
          if (response?.slug) navigate(`/product/${response.slug}${window.location.search}`, { replace: true });
          else { setProduct(null); setProductsLoading(false); }
        })
        .catch(() => { if (active) { setProduct(null); setProductsLoading(false); } });
      return () => { active = false; };
    }

    getProductBySlug(slug)
      .then((response) => { if (active) { setProduct(mapProduct(response)); setProductsLoading(false); } })
      .catch(() => { if (active) { setProduct(null); setProductsLoading(false); } });
    return () => { active = false; };
  }, [slug, navigate]);

  const id = product ? String(product.productId) : null;

  /**
   * Canonical URL and social metadata, pointed at the slug.
   *
   * Written straight into document.head rather than through a helper library, because the project
   * has no metadata layer and adding one for three tags would be a larger change than the tags.
   * Kept in sync on every product change and left in place on unmount — a stale canonical is only
   * read by a crawler on a product page, and every product page sets it before paint.
   */
  useEffect(() => {
    if (!product?.slug) return;
    const url = `${window.location.origin}${process.env.PUBLIC_URL || ""}/product/${product.slug}`;
    const upsert = (selector, create) => {
      let element = document.head.querySelector(selector);
      if (!element) { element = create(); document.head.appendChild(element); }
      return element;
    };
    const canonical = upsert('link[rel="canonical"]', () => {
      const link = document.createElement("link"); link.rel = "canonical"; return link;
    });
    canonical.href = url;
    const ogUrl = upsert('meta[property="og:url"]', () => {
      const meta = document.createElement("meta"); meta.setAttribute("property", "og:url"); return meta;
    });
    ogUrl.setAttribute("content", url);
    const ogTitle = upsert('meta[property="og:title"]', () => {
      const meta = document.createElement("meta"); meta.setAttribute("property", "og:title"); return meta;
    });
    ogTitle.setAttribute("content", product.name);
    document.title = `${product.name} · Shades World`;
  }, [product]);

  // The variant this URL resolves to, by the one shared rule: the Main Product when purchasable,
  // else the first purchasable variant in family order. An in-stock ?variant= position wins; an
  // unknown, inactive or out-of-stock one falls back to that rule; null means genuinely nothing
  // is buyable.
  const resolvedVariant = useMemo(
    () => (product ? selectDefaultVariant(product.variants, requestedPosition) : null),
    [product, requestedPosition]
  );

  useEffect(() => {
    if (!product) return;
    // Initialises the selection, and REPAIRS it when the product changes — but never overwrites a
    // selection that is still valid.
    //
    // This used to assign unconditionally on [product, resolvedVariant]. Because resolvedVariant is
    // recomputed whenever the product object changes identity, any re-render that produced a fresh
    // product — a refetch, or simply this page's own load settling after the customer had already
    // clicked — silently threw the chosen colourway away and reverted to the default. It showed up
    // as a colour tile that "un-clicked" itself, and as three intermittently failing tests here.
    setSelectedVariantId((current) => {
      const stillValid = current != null && product.variants?.some((variant) => variant.variantId === current);
      if (stillValid) return current;
      // variants[0] only when nothing is purchasable: the sold-out page still has to name a colour.
      return (resolvedVariant || product.variants?.[0] || null)?.variantId ?? null;
    });
    // Which photo shows is now the gallery's own state, keyed off the image list it is handed.
    // The list leads with the SELECTED variant's photos, so the page still opens on the colourway
    // it is quoting — the property that mattered when this set an explicit hero image, and the
    // reason it did not simply lead with isPrimary: a product whose primary shot belonged to a
    // sold-out colourway used to open showing that colourway while quoting a different one's
    // price, SKU and stock.
  }, [product, resolvedVariant]);

  // The primary photo is a view of the product, not a purchasable option: it only
  // drives the hero image, while selectedVariant stays the single purchase target.
  // A stale selectedVariantId (kept across a related-product link) resolves through the shared
  // rule rather than to whichever variant happens to be first.
  const selectedVariant = product?.variants?.find((variant) => variant.variantId === selectedVariantId)
    || resolvedVariant || product?.variants?.[0];
  // variantLabel is shared with the listing, the wishlist and the bag — see StoreContext.
  /**
   * The gallery for the selected colourway: that variant's photos first, then the general product
   * photos, so a customer looking at Blue sees Blue before the shared studio shots.
   *
   * Falls back to the general photos when the variant has none of its own, and to everything the
   * product has when it has no general photos either — a product whose every image belongs to some
   * variant must still show a gallery rather than an empty frame.
   *
   * Ids are compared as strings: variantId arrives as a number on the image and on the variant, but
   * the ?variant= round trip makes the selected one a string, and === across those silently matched
   * nothing.
   */
  const gallery = useMemo(() => galleryFor(product, selectedVariant), [product, selectedVariant]);
  // True when the gallery is showing another colourway's photography because this one has none.
  // Said out loud below rather than left for the customer to misread as the thing they are buying.
  const borrowedPhotos = Boolean(gallery.length) && isBorrowedImage(product, selectedVariant, gallery[0]);
  const chooseVariant = (variant) => {
    setSelectedVariantId(variant.variantId);
    // No explicit image is set here any more: changing the variant changes the gallery's list,
    // and the gallery resets to that list's first photo. Selecting a colour therefore shows that
    // colour, while clicking a thumbnail changes only the photo — a gallery click must never
    // silently re-target what Add to Bag will buy.
    // Reflect the choice in the URL so a refresh, a share or Back/Forward lands on the same
    // colourway. `replace` because a colour swatch is not a navigation step — pushing would make
    // Back walk the customer through their own clicks instead of leaving the product page.
    //
    // Only purchasable variants are written. selectDefaultVariant deliberately refuses to honour
    // a request for something out of stock, so writing one would round-trip straight back to the
    // fallback and fight this component's own state. The value is the family position — see
    // requestedPosition above for why the id must not appear in the URL.
    if (Number(variant.quantityAvailable) > 0 && variant.isActive !== false) {
      const next = new URLSearchParams(params);
      next.set("variant", String(variant.position));
      setParams(next, { replace: true });
    }
  };

  if (productsLoading) return <div className="container pd-message">Loading product…</div>;
  if (!product) return <div className="container pd-message"><h2>Product not found</h2><Link to="/" className="back-link">← Back to shop</Link></div>;

  const key = selectedVariant ? `${id}:${selectedVariant.variantId}` : id;
  const count = cartItems[key] || 0;
  const related = product_list.filter((item) => item.category === product.category && item._id !== id).slice(0, 4);
  const color = variantLabel(selectedVariant) || product.color;
  const available = Number(selectedVariant?.quantityAvailable || 0);
  const bagCount = (variant) => cartItems[`${id}:${variant.variantId}`] || 0;
  // A colour name is not a unique variant identifier; fall back to the SKU to tell
  // two same-coloured variants apart wherever one is named.
  const labelUses = product.variants.reduce((counts, variant) => ({ ...counts, [variantLabel(variant)]: (counts[variantLabel(variant)] || 0) + 1 }), {});
  const ambiguous = (variant) => labelUses[variantLabel(variant)] > 1;
  const addLabel = selectedVariant && ambiguous(selectedVariant) ? `${color} (${selectedVariant.sku})` : color;
  const saved = isWishlisted(id);
  // Inline, not window.alert — see the matching note in ProductCard.
  const saveProduct = async () => {
    if (!user) return navigate("/signin");
    setWishlistError("");
    try { await toggleWishlist(id); } catch (error) { setWishlistError(error.message); }
  };

  // ── The three tabs, all keyed off the selected variant ────────────────────────────────
  // Description: a variant may carry its own copy; otherwise it inherits the product's, and
  // we say so rather than implying the shared text was written for this colourway.
  const variantDescription = selectedVariant?.variantDescription?.trim();
  const variantCopy = variantDescription
    ? { description: variantDescription, inherited: false }
    : { description: product.description || "No description available.", inherited: true };

  // Details: variant attributes take precedence over product-level ones of the same name, and
  // the identifying facts of this exact variant lead the list, so the tab visibly changes with
  // the selection instead of repeating one product-wide table.
  const productAttributes = Object.entries(product.attributes || {});
  const variantAttributes = Object.entries(selectedVariant?.attributes || {});
  const variantAttributeNames = new Set(variantAttributes.map(([name]) => name));
  const variantDetails = [
    ...(selectedVariant?.variantName ? [{ name: "colourway", value: selectedVariant.variantName, variantSpecific: true }] : []),
    ...(selectedVariant?.sku ? [{ name: "SKU", value: selectedVariant.sku, variantSpecific: true }] : []),
    ...variantAttributes.map(([name, value]) => ({ name, value, variantSpecific: true })),
    ...productAttributes
      .filter(([name]) => !variantAttributeNames.has(name))
      .map(([name, value]) => ({ name, value, variantSpecific: false })),
  ];

  // Shipping: derived from this variant's real stock rather than a second editable copy field,
  // so it can never contradict what the bag actually charges or what checkout will allow.
  const lowStock = Number(selectedVariant?.lowStockThreshold || 0);
  const unitPrice = Number(selectedVariant?.price ?? product.price);
  const shippingCopy = {
    dispatch: available <= 0
      ? `${color} is out of stock and cannot be dispatched.`
      : available <= lowStock
        ? `Only ${available} left in ${color} — dispatches within 1 business day.`
        : `${color} is in stock and dispatches within 1 business day.`,
    freeShipping: unitPrice >= 500
      ? "Free shipping — this colourway is over the ₹500 threshold."
      : `Free shipping on orders of ₹500 or more; add ₹${(500 - unitPrice).toLocaleString("en-IN")} more to qualify.`,
  };

  return <div className="product-detail"><div className="container"><Link to="/" className="back-link">← Back to shop</Link><div className="pd-layout"><div className="pd-image-section"><ProductGallery images={gallery} productName={product.name} badge={product.isNew ? <span className="pd-badge">New</span> : null} />{borrowedPhotos && <p className="pd-photo-note">These photos show the main product — there are none for {color} yet.</p>}</div><div className="pd-info-section"><span className="pd-category">{product.categories.map((category) => category.categoryName).join(" · ") || product.category}</span><h1 className="pd-title">{product.name}</h1>{selectedVariant?.sku && <p className="pd-sku">{selectedVariant.sku}</p>}<p className="pd-brand">{product.brand}</p><p className="pd-price">₹{Number(selectedVariant?.price ?? product.price).toLocaleString("en-IN")}</p>
    {product.variants.length > 0 && <div className="pd-variants"><div className="pd-variant-label"><span>Choose color</span><strong>{color}</strong></div><div className="pd-variant-options">{product.variants.map((variant) => { const variantColor = variantLabel(variant); const image = imageForVariant(product, variant); const borrowedTile = isBorrowedImage(product, variant, image); const inBag = bagCount(variant); return <button key={variant.variantId} className={selectedVariant?.variantId === variant.variantId ? "active" : ""} onClick={() => chooseVariant(variant)} disabled={variant.quantityAvailable <= 0 && inBag === 0}>{image ? <img src={image.imageUrl} alt={`${product.name} ${variantColor}`} /> : <span className="pd-variant-no-image">No photo</span>}<span>{variantColor}</span>{ambiguous(variant) && <small>{variant.sku}</small>}{/* Says the photo is a stand-in. Under the redesigned rule the only stand-in a tile can carry
    is the Main Product's photography — no other colourway's is ever borrowed. */}
{borrowedTile && <small>Main product photo</small>}{variant.quantityAvailable <= 0 && <small>Out of stock</small>}{inBag > 0 && <small className="pd-variant-in-bag">{inBag} in bag</small>}</button>; })}</div><p className={`pd-stock ${available <= (selectedVariant?.lowStockThreshold || 0) ? "low" : ""}`}>{available > 0 ? `${available} in stock` : "Currently unavailable"}</p></div>}
    <div className="pd-actions">
      <button className={`pd-wishlist-btn ${saved ? "saved" : ""}`} onClick={saveProduct}>{saved ? "♥ Saved to wishlist" : "♡ Save to wishlist"}</button>
      {/* No quantity stepper here by design: the bag is edited in the bag. With the stepper
          gone this button is the only guard left, so it carries the per-variant stock cap. */}
      <button className="pd-add-btn" disabled={available <= 0 || count >= available}
        onClick={() => addToCart(id, selectedVariant?.variantId)}>
        {available <= 0 ? "Out of stock" : count >= available ? `All ${available} in your bag` : `Add ${addLabel} to bag`}
      </button>
      {count > 0 && <Link to="/cart" className="pd-view-cart">View bag →</Link>}
      {wishlistError && <p className="pd-wishlist-error" role="alert">{wishlistError}</p>}
    </div>
    <div className="pd-tabs">
      <button className={activeTab === "description" ? "active" : ""} onClick={() => setActiveTab("description")}>Description</button>
      <button className={activeTab === "details" ? "active" : ""} onClick={() => setActiveTab("details")}>Details</button>
      <button className={activeTab === "shipping" ? "active" : ""} onClick={() => setActiveTab("shipping")}>Shipping</button>
    </div>
    <div className="pd-tab-content">
      {activeTab === "description" && <>
        <p>{variantCopy.description}</p>
        {variantCopy.inherited && product.variants.length > 1 && <p className="pd-tab-note">This description covers every colourway.</p>}
      </>}
      {activeTab === "details" && <ul>
        {variantDetails.map(({ name, value, variantSpecific }) => <li key={name} className={variantSpecific ? "pd-detail-variant" : ""}>
          {name.replaceAll("_", " ")}: {value}
        </li>)}
      </ul>}
      {activeTab === "shipping" && <div>
        <p>{shippingCopy.dispatch}</p>
        <p>{shippingCopy.freeShipping}</p>
        <p>Standard delivery: 3–5 business days after dispatch.</p>
        <p>30-day hassle-free returns.</p>
      </div>}
    </div></div></div>
    <ProductReviews productId={id} />
    {related.length > 0 && <div className="pd-related"><h2>You may also like</h2><div className="pd-related-grid">{related.map((item) => <Link to={productPath(item)} key={item._id} className="pd-related-card"><div className="pd-related-img"><img src={item.image} alt={item.name} /></div><p className="pd-related-name">{item.name}</p><p className="pd-related-price">₹{item.price.toLocaleString("en-IN")}</p></Link>)}</div></div>}
  </div></div>;
}
