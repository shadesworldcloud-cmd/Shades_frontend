import React, { useEffect, useLayoutEffect, useRef } from "react";
import Navbar from "./components/Navbar/Navbar";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Home from "./pages/Home/Home";
import Cart from "./pages/Cart/Cart";
import PlaceOrder from "./pages/PlaceOrder/PlaceOrder";
import ProductDetail from "./pages/ProductDetail/ProductDetail";
import Footer from "./components/Footer/Footer";
import PromoBar from "./components/PromoBar/PromoBar";
import SignIn from "./pages/SignIn/SignIn";
import AdminDashboard from "./pages/Admin/AdminDashboard";
import ProtectedRoute from "./components/ProtectedRoute/ProtectedRoute";
import { useAuth } from "./context/AuthContext";
import MyOrders from "./pages/MyOrders/MyOrders";
import Wishlist from "./pages/Wishlist/Wishlist";
import Account from "./pages/Account/Account";
import Notifications from "./pages/Notifications/Notifications";
import StoreInfo from "./pages/StoreInfo/StoreInfo";
import Shop from "./pages/Shop/Shop";
import Collections from "./pages/Collections/Collections";

const ScrollToTop = () => {
  const { pathname, hash } = useLocation();

  useLayoutEffect(() => {
    if (hash) return undefined;

    const root = document.documentElement;
    const previousBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    root.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    const restoreFrame = window.requestAnimationFrame(() => {
      root.style.scrollBehavior = previousBehavior;
    });

    return () => {
      window.cancelAnimationFrame(restoreFrame);
      root.style.scrollBehavior = previousBehavior;
    };
  }, [pathname, hash]);

  return null;
};

const AdminExitGuard = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAdmin, signOut } = useAuth();
  const previousPath = useRef(location.pathname);

  useEffect(() => {
    const wasInAdmin = previousPath.current.startsWith("/admin");
    const isInAdmin = location.pathname.startsWith("/admin");
    previousPath.current = location.pathname;

    if (wasInAdmin && !isInAdmin && isAdmin) {
      // .finally() re-throws a rejection, so this needs .catch() as well: signOut no longer
      // rejects, but a guard that runs on browser navigation must not be able to produce an
      // unhandled rejection if that ever changes. replace:true keeps the admin page out of the
      // history entry we are leaving, so Back cannot return to it.
      signOut()
        .catch(() => undefined)
        .finally(() => navigate("/signin", { replace: true }));
    }
  }, [location.pathname, isAdmin, navigate, signOut]);

  return null;
};

const App = () => {
  return (
    <><a className="skip-link" href="#main-content">Skip to main content</a><ScrollToTop /><AdminExitGuard /><div id="main-content" tabIndex="-1"><Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/admin" element={<ProtectedRoute adminOnly><AdminDashboard /></ProtectedRoute>} />
      <Route path="*" element={<>
        <div className="app"><PromoBar /><Navbar /><Routes>
          <Route path="/" element={<Home />} />
          {/* Inside the inner Routes so both pages keep the Navbar, PromoBar and Footer. */}
          <Route path="/shop" element={<Shop />} />
          <Route path="/collections" element={<Collections />} />
          <Route path="/collections/:collection" element={<Collections />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/order" element={<ProtectedRoute><PlaceOrder /></ProtectedRoute>} />
          {/* One route for both forms. A numeric segment is a legacy /product/{PRODUCT_ID} link
              and ProductDetail redirects it to the canonical slug; anything else is a slug. Kept
              as one route rather than two because react-router matches both patterns identically
              and a second route would only decide which component runs the same redirect. */}
          <Route path="/product/:slug" element={<ProductDetail />} />
          <Route path="/my-orders" element={<ProtectedRoute><MyOrders /></ProtectedRoute>} />
          <Route path="/wishlist" element={<ProtectedRoute><Wishlist /></ProtectedRoute>} />
          <Route path="/account" element={<ProtectedRoute customerOnly><Account /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute customerOnly><Notifications /></ProtectedRoute>} />
          <Route path="/info/:page" element={<StoreInfo />} />
        </Routes></div><Footer />
      </>} />
    </Routes></div></>
  );
};

export default App;
