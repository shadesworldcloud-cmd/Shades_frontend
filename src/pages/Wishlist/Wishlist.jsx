import { useContext } from "react";
import { Link } from "react-router-dom";
import { StoreContext, variantLabel, productPath } from "../../context/StoreContext";
import "./Wishlist.css";

const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

export default function Wishlist() {
  const { wishlistItems, wishlistLoading, toggleWishlist, product_list, addToCart } = useContext(StoreContext);
  return <main className="wishlist-page"><div className="container">
    <header className="wishlist-header"><div><span>Your collection</span><h1>Wishlist</h1><p>Pieces you saved for another look.</p></div><Link to="/shop">Continue shopping</Link></header>
    {wishlistLoading ? <div className="wishlist-empty">Loading your saved collection…</div> : wishlistItems.length === 0 ? <div className="wishlist-empty"><b>♡</b><h2>Your wishlist is empty</h2><p>Tap the heart on any frame to save it here.</p><Link to="/shop">Explore eyewear</Link></div> : <section className="wishlist-grid">{wishlistItems.map((item) => {
      const product = product_list.find((value) => String(value.productId) === String(item.productId));
      const availableVariants = (product?.variants || []).filter((value) => value.isActive && Number(value.quantityAvailable) > 0).sort((a, b) => Number(a.price) - Number(b.price));
      const exactVariant = availableVariants.length === 1 ? availableVariants[0] : null;
      const exactLabel = variantLabel(exactVariant);
      const available = item.active && availableVariants.length > 0;
      const displayPrice = exactVariant?.price ?? availableVariants[0]?.price ?? item.price;
      return <article className="wishlist-card" key={item.wishlistItemId}><Link to={productPath(item)}><div className="wishlist-image">{item.imageUrl ? <img src={item.imageUrl} alt={item.imageAlt || item.productName}/> : <span>SW</span>}{!available && <em>Unavailable</em>}</div></Link><div className="wishlist-copy"><small>{item.brand || "Shades World Barcelona"}</small><Link to={productPath(item)}><h2>{item.productName}</h2></Link><strong>{availableVariants.length > 1 ? "From " : ""}{money(displayPrice)}</strong><div>{availableVariants.length > 1 ? <Link className="wishlist-options" to={productPath(item)}>Choose options</Link> : <button disabled={!available} aria-label={!available ? `${item.productName} is out of stock` : exactLabel ? `Add ${item.productName} in ${exactLabel} to bag` : `Add ${item.productName} to bag`} onClick={() => addToCart(String(item.productId), exactVariant?.variantId)}>{available ? (exactLabel ? `Add ${exactLabel} to bag` : "Add to bag") : "Out of stock"}</button>}<button aria-label={`Remove ${item.productName} from wishlist`} onClick={() => toggleWishlist(item.productId)}>Remove</button></div></div></article>;
    })}</section>}
  </div></main>;
}
