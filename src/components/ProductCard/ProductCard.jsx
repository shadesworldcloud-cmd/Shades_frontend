import React, { useContext, useState } from "react";
import "./ProductCard.css";
import { Link, useNavigate } from "react-router-dom";
import { StoreContext, listingPrice, productPath } from "../../context/StoreContext";
import { useAuth } from "../../context/AuthContext";

const ProductCard = ({ id, slug, name, price, variantPrice, priceFrom, image, color, isNew, variantId, stock, available = true }) => {
  const { cartItems, addToCart, isWishlisted, toggleWishlist } = useContext(StoreContext);
  const { user } = useAuth();
  const navigate = useNavigate();
  const cartKey = variantId ? `${id}:${variantId}` : String(id);
  const count = cartItems[cartKey] || 0;
  const saved = isWishlisted(id);
  // Inline status rather than window.alert: a native alert blocks the whole tab for a failure that
  // belongs to one card, and it cannot be styled, dismissed by Escape or read in context.
  const [saveError, setSaveError] = useState("");
  const save = async () => {
    if (!user) return navigate("/signin");
    setSaveError("");
    try { await toggleWishlist(id); } catch (error) { setSaveError(error.message); }
  };
  // The card commits exactly one colourway, so it quotes that variant's own price and caps
  // at that variant's own stock; the product-level minimum only appears as a "from" hint.
  // The rule lives in StoreContext because ProductGrid's sort has to order by this exact number.
  const unitPrice = listingPrice(variantPrice, price);
  const cap = stock == null || !Number.isFinite(Number(stock)) ? null : Number(stock);
  const inStock = available && cap !== 0;
  const atCap = cap !== null && count >= cap;
  const target = color ? `${name} in ${color}` : name;

  return (
    <div className="product-card">
      <button className={`wishlist-heart ${saved ? "saved" : ""}`} onClick={save} aria-label={saved ? `Remove ${name} from wishlist` : `Add ${name} to wishlist`}>{saved ? "♥" : "♡"}</button>
      <Link to={productPath({ slug, productId: id })} className="product-card-link">
        <div className="product-card-image">
          <img src={image} alt={name} />
          {isNew && <span className="new-badge">New</span>}
        </div>
      </Link>

      <div className="product-card-info">
        <Link to={productPath({ slug, productId: id })}>
          <p className="product-name">{name}</p>
        </Link>
        {color && <p className="product-color">{color}</p>}
        <p className="product-price">₹{unitPrice.toLocaleString("en-IN")}</p>
        {saveError && <p className="product-card-error" role="alert">{saveError}</p>}
        {priceFrom != null && Number(priceFrom) < unitPrice && <p className="product-price-note">Other colours from ₹{Number(priceFrom).toLocaleString("en-IN")}</p>}

        {/* No quantity stepper on the listing by design: quantities are edited in the bag.
            The stepper used to be the only client-side stock ceiling, so the cap moves onto
            this button — otherwise repeated clicks would push past stock until the API 400s. */}
        <div className="product-card-actions">
          <button className="add-to-bag" disabled={!variantId || !inStock || atCap}
            aria-label={!inStock ? `${name} is out of stock` : atCap ? `No more ${target} available` : `Add ${target} to bag`}
            onClick={() => addToCart(id, variantId)}>
            {!inStock ? "Out of stock" : atCap ? `All ${cap} in your bag` : color ? `Add ${color} to bag` : "Add to bag"}
          </button>
          {count > 0 && <Link to="/cart" className="product-card-in-bag">{count} in bag · View bag →</Link>}
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
