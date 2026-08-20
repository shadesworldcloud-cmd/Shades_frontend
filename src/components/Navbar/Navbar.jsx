import React, { useContext, useEffect, useState } from "react";
import "./Navbar.css";
import { assets } from "../../assets/assets";
import { Link } from "react-router-dom";
import { StoreContext } from "../../context/StoreContext";
import { useAuth } from "../../context/AuthContext";
import BrandWordmark from "../BrandWordmark/BrandWordmark";
import NotificationBell from "../NotificationBell/NotificationBell";

const Navbar = () => {
  const [menu, setMenu] = useState("home");
  const [mobileOpen, setMobileOpen] = useState(false);
  const { getCartCount, wishlistItems, cartError } = useContext(StoreContext);
  const { user, isAdmin, signOut } = useAuth();

  const cartCount = getCartCount();

  const closeMenu = () => setMobileOpen(false);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") setMobileOpen(false); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", closeOnEscape); };
  }, [mobileOpen]);

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <button
          className="hamburger"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Menu"
          aria-expanded={mobileOpen}
          aria-controls="storefront-navigation"
        >
          <span className={mobileOpen ? "open" : ""} />
          <span className={mobileOpen ? "open" : ""} />
          <span className={mobileOpen ? "open" : ""} />
        </button>

        <Link to="/" className="logo-link" onClick={closeMenu}>
          <BrandWordmark compact />
        </Link>

        <ul id="storefront-navigation" className={`navbar-menu ${mobileOpen ? "open" : ""}`}>
          <li>
            <Link
              to="/"
              onClick={() => { setMenu("home"); closeMenu(); }}
              className={menu === "home" ? "active" : ""}
            >
              Home
            </Link>
          </li>
          <li>
            <Link
              to="/shop"
              onClick={() => { setMenu("shop"); closeMenu(); }}
              className={menu === "shop" ? "active" : ""}
            >
              Shop
            </Link>
          </li>
          <li>
            <Link
              to="/collections"
              onClick={() => { setMenu("collections"); closeMenu(); }}
              className={menu === "collections" ? "active" : ""}
            >
              Collections
            </Link>
          </li>
          <li>
            <Link
              to="/info/contact"
              onClick={() => { setMenu("contact"); closeMenu(); }}
              className={menu === "contact" ? "active" : ""}
            >
              Contact
            </Link>
          </li>
          {user && !isAdmin && <li><Link to="/my-orders" onClick={() => { setMenu("orders"); closeMenu(); }} className={menu === "orders" ? "active" : ""}>My Orders</Link></li>}
          {user && !isAdmin && <li><Link to="/wishlist" onClick={() => { setMenu("wishlist"); closeMenu(); }} className={menu === "wishlist" ? "active" : ""}>Wishlist{wishlistItems.length ? ` (${wishlistItems.length})` : ""}</Link></li>}
          {user && !isAdmin && <li><Link to="/account" onClick={() => { setMenu("account"); closeMenu(); }} className={menu === "account" ? "active" : ""}>Account</Link></li>}
        </ul>

        {mobileOpen && (
          <button type="button" className="mobile-overlay" onClick={closeMenu} aria-label="Close menu" />
        )}

        <div className="navbar-right">
          <NotificationBell />
          {/* Portal target for the collection filter icon. ProductGrid owns every filter's state
              and renders its icon plus the Refine panel in here, so the affordance sits beside the
              bag on listing pages and is simply absent everywhere else. Kept as a slot rather than
              lifting the filter state into a context: the state is read by nothing but the grid,
              and three pages would have had to thread it through. */}
          <div className="nav-filter-slot" id="nav-filter-slot" />
          <div className="cart-icon-wrapper">
            <Link to="/cart" aria-label={`Cart${cartCount ? `, ${cartCount} item${cartCount === 1 ? "" : "s"}` : ""}`}>
              <img
                src={assets.basket_icon}
                alt="Cart"
                className="nav-icon"
              />
            </Link>
            {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
          </div>
          {user ? (
            <div className="nav-user">
              {isAdmin && <Link to="/admin" className="nav-admin-link">Admin</Link>}
              {!isAdmin && <Link to="/account">Hi, {user.name?.split(" ")[0]}</Link>}
              {isAdmin && <span>Hi, {user.name?.split(" ")[0]}</span>}
              <button className="nav-account" onClick={signOut}>Sign out</button>
            </div>
          ) : <Link className="nav-account" to="/signin">Sign in</Link>}
        </div>
      </div>
      {cartError && <p className="navbar-cart-error" role="alert">{cartError} <Link to="/cart" onClick={closeMenu}>Review your bag</Link></p>}
    </nav>
  );
};

export default Navbar;
