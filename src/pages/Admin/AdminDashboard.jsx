import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { createCoupon, getCoupons, setCouponActive, updateCoupon as updateCouponRequest } from "../../services/api";
import AdminAutomaticOffer from "./AdminAutomaticOffer";
import AdminProducts from "./AdminProducts";
import AdminOrders from "./AdminOrders";
import AdminInventory from "./AdminInventory";
import AdminCustomers from "./AdminCustomers";
import AdminReturns from "./AdminReturns";
import AdminEmailOutbox from "./AdminEmailOutbox";
import AdminOverview from "./AdminOverview";
import AdminStorefront from "./AdminStorefront";
import Notifications from "../Notifications/Notifications";
import AdminReviews from "./AdminReviews";
import "./AdminDashboard.css";
import useConfirmAction from "../../hooks/useConfirmAction";

const toLocalInput = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const initialOffer = () => {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 30);
  return {
    couponCode: "", description: "", discountType: "PERCENTAGE",
    discountValue: "", minimumOrderAmount: "0", maximumDiscountAmount: "",
    usageLimit: "", usageLimitPerUser: "1",
    validFrom: toLocalInput(now), validTo: toLocalInput(end),
  };
};

const offerState = (coupon) => {
  const now = Date.now();
  if (!coupon.isActive) return "Inactive";
  if (new Date(coupon.validFrom).getTime() > now) return "Scheduled";
  if (new Date(coupon.validTo).getTime() < now) return "Expired";
  return "Active";
};

const AdminDashboard = () => {
  const { user, accessToken, signOut } = useAuth();
  const confirmAction = useConfirmAction();
  const [section, setSection] = useState("overview");
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [offer, setOffer] = useState(initialOffer);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadOffers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const page = await getCoupons(accessToken);
      setCoupons(page.content || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { loadOffers(); }, [loadOffers]);

  const updateOffer = (field, value) => setOffer((current) => ({ ...current, [field]: value }));

  const submitOffer = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (new Date(offer.validTo) <= new Date(offer.validFrom)) {
      setError("The end date must be later than the start date.");
      return;
    }
    if (offer.discountType === "PERCENTAGE" && Number(offer.discountValue) > 100) {
      setError("A percentage discount cannot be greater than 100%.");
      return;
    }
    const payload = {
      ...offer,
      couponCode: offer.couponCode.trim().toUpperCase(),
      discountValue: Number(offer.discountValue),
      minimumOrderAmount: Number(offer.minimumOrderAmount || 0),
      maximumDiscountAmount: offer.maximumDiscountAmount ? Number(offer.maximumDiscountAmount) : null,
      usageLimit: offer.usageLimit ? Number(offer.usageLimit) : null,
      usageLimitPerUser: offer.usageLimitPerUser ? Number(offer.usageLimitPerUser) : null,
      validFrom: offer.validFrom,
      validTo: offer.validTo,
    };
    setSaving(true);
    try {
      const saved = editingId
        ? await updateCouponRequest(accessToken, editingId, payload)
        : await createCoupon(accessToken, payload);
      setCoupons((current) => editingId
        ? current.map((item) => item.couponId === saved.couponId ? saved : item)
        : [saved, ...current]);
      setOffer(initialOffer());
      setEditingId(null);
      setShowForm(false);
      setNotice(`${saved.couponCode} was ${editingId ? "updated" : "created"}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = (coupon) => {
    const active = !coupon.isActive;
    // The dialog owns the busy guard and surfaces failures in place, so the old try/catch that
    // wrote to the page-level error banner is gone with the window.confirm it belonged to.
    return confirmAction.ask({
      title: `${active ? "Activate" : "Deactivate"} this offer?`,
      body: <p>Coupon <strong>{coupon.couponCode}</strong> will {active ? "become usable at checkout" : "stop being accepted at checkout"}.</p>,
      confirmLabel: active ? "Activate" : "Deactivate",
      busyLabel: "Saving…",
      run: async () => {
        setError("");
        const updated = await setCouponActive(accessToken, coupon.couponId, active);
        setCoupons((current) => current.map((item) => item.couponId === coupon.couponId ? updated : item));
        setNotice(`${coupon.couponCode} has been ${active ? "activated" : "deactivated"}.`);
      },
    });
  };

  const editOffer = (coupon) => {
    setOffer({ couponCode: coupon.couponCode, description: coupon.description || "", discountType: coupon.discountType,
      discountValue: String(coupon.discountValue), minimumOrderAmount: String(coupon.minimumOrderAmount || 0),
      maximumDiscountAmount: coupon.maximumDiscountAmount == null ? "" : String(coupon.maximumDiscountAmount),
      usageLimit: coupon.usageLimit == null ? "" : String(coupon.usageLimit),
      usageLimitPerUser: coupon.usageLimitPerUser == null ? "" : String(coupon.usageLimitPerUser),
      validFrom: String(coupon.validFrom).slice(0, 16), validTo: String(coupon.validTo).slice(0, 16) });
    setEditingId(coupon.couponId); setShowForm(true); setError(""); setNotice("");
  };

  const navigateSection = (nextSection) => {
    setSection(nextSection);
    setNotice("");
    setError("");
  };
  const goToOffers = () => navigateSection("offers");

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-wordmark">SHADES <span>WORLD</span></div>
        <nav aria-label="Admin navigation">
          <button className={section === "overview" ? "active" : ""} onClick={() => navigateSection("overview")}>Overview</button>
          <button className={section === "offers" ? "active" : ""} onClick={goToOffers}>Offers</button>
          <button className={section === "automatic-offer" ? "active" : ""} onClick={() => navigateSection("automatic-offer")}>Automatic Pair/Quantity Offer</button>
          <button className={section === "products" ? "active" : ""} onClick={() => { setSection("products"); setError(""); setNotice(""); }}>Products</button><button className={section === "orders" ? "active" : ""} onClick={() => { setSection("orders"); setError(""); setNotice(""); }}>Orders</button><button className={section === "returns" ? "active" : ""} onClick={() => setSection("returns")}>Returns & refunds</button><button className={section === "inventory" ? "active" : ""} onClick={() => setSection("inventory")}>Inventory</button><button className={section === "customers" ? "active" : ""} onClick={() => setSection("customers")}>Customers</button><button className={section === "storefront" ? "active" : ""} onClick={() => navigateSection("storefront")}>Storefront</button><button className={section === "reviews" ? "active" : ""} onClick={() => navigateSection("reviews")}>Review moderation</button><button className={section === "notifications" ? "active" : ""} onClick={() => navigateSection("notifications")}>Notifications</button><button className={section === "email-outbox" ? "active" : ""} onClick={() => setSection("email-outbox")}>Email outbox</button>
        </nav>
        <button className="admin-signout" onClick={signOut}>Sign out</button>
      </aside>

      {confirmAction.dialog}
      <main className="admin-main">
        <header className="admin-header"><div><span>Store administration</span><h1>{section === "offers" ? "Offers & coupons" : section === "automatic-offer" ? "Automatic Pair/Quantity Offer" : section === "products" ? "Product catalog" : section === "orders" ? "Order operations" : section === "returns" ? "Returns & refunds" : section === "inventory" ? "Stock operations" : section === "customers" ? "Customer management" : section === "reviews" ? "Review moderation" : section === "notifications" ? "Notification centre" : section === "email-outbox" ? "Email operations" : `Good day, ${user?.name?.split(" ")[0]}.`}</h1></div><div className="admin-avatar">{user?.name?.charAt(0)?.toUpperCase()}</div></header>
        {error && <div className="admin-alert error" role="alert">{error}</div>}
        {notice && <div className="admin-alert success" role="status">{notice}</div>}

        {section === "overview" ? <AdminOverview coupons={coupons} offersLoading={loading} onNavigate={navigateSection} onNewOffer={() => { goToOffers(); setShowForm(true); }} /> : section === "offers" ? <>
          <div className="offers-toolbar"><div><p>Create and control the codes customers use at checkout.</p></div><button onClick={() => { setShowForm((value) => !value); setEditingId(null); setOffer(initialOffer()); setError(""); }}>{showForm ? "Close form" : "+ New offer"}</button></div>

          {showForm && <form className="offer-form" onSubmit={submitOffer}>
            <div className="offer-form-heading"><div><span>{editingId ? "Campaign settings" : "New campaign"}</span><h2>{editingId ? "Edit offer" : "Create an offer"}</h2></div><p>Fields marked * are required.</p></div>
            <div className="offer-form-grid">
              <label>Coupon code *<input value={offer.couponCode} onChange={(e) => updateOffer("couponCode", e.target.value)} placeholder="SUMMER25" maxLength="50" required /></label>
              <label>Description<input value={offer.description} onChange={(e) => updateOffer("description", e.target.value)} placeholder="Summer collection promotion" maxLength="255" /></label>
              <label>Discount type *<select value={offer.discountType} onChange={(e) => updateOffer("discountType", e.target.value)}><option value="PAIR_FIXED">Amount off every 2 units</option><option value="PERCENTAGE">Percentage</option><option value="FIXED">Fixed amount</option></select></label>
              <label>{offer.discountType === "PERCENTAGE" ? "Discount percent *" : offer.discountType === "PAIR_FIXED" ? "Discount per 2 units (₹) *" : "Discount amount (₹) *"}<input type="number" min="0.01" step="0.01" value={offer.discountValue} onChange={(e) => updateOffer("discountValue", e.target.value)} placeholder={offer.discountType === "PAIR_FIXED" ? "500" : ""} required /></label>
              {offer.discountType === "PAIR_FIXED" && <div className="pair-offer-preview"><span>How it works</span><strong>14 units ÷ 2 = 7 pairs</strong><p>7 × ₹{Number(offer.discountValue || 0).toLocaleString("en-IN")} = ₹{(7 * Number(offer.discountValue || 0)).toLocaleString("en-IN")} total discount</p><small>An unmatched odd unit receives no discount.</small></div>}
              <label>Minimum order (₹)<input type="number" min="0" step="0.01" value={offer.minimumOrderAmount} onChange={(e) => updateOffer("minimumOrderAmount", e.target.value)} /></label>
              <label>Maximum discount (₹)<input type="number" min="0" step="0.01" value={offer.maximumDiscountAmount} onChange={(e) => updateOffer("maximumDiscountAmount", e.target.value)} placeholder="No cap" /></label>
              <label>Starts *<input type="datetime-local" value={offer.validFrom} onChange={(e) => updateOffer("validFrom", e.target.value)} required /></label>
              <label>Ends *<input type="datetime-local" value={offer.validTo} onChange={(e) => updateOffer("validTo", e.target.value)} required /></label>
              <label>Total usage limit<input type="number" min="1" value={offer.usageLimit} onChange={(e) => updateOffer("usageLimit", e.target.value)} placeholder="Unlimited" /></label>
              <label>Uses per customer<input type="number" min="1" value={offer.usageLimitPerUser} onChange={(e) => updateOffer("usageLimitPerUser", e.target.value)} placeholder="Unlimited" /></label>
            </div>
            <div className="offer-form-actions"><button type="button" onClick={() => { setShowForm(false); setEditingId(null); setOffer(initialOffer()); }}>Cancel</button><button type="submit" disabled={saving}>{saving ? "Saving..." : editingId ? "Save changes" : "Publish offer"}</button></div>
          </form>}

          <section className="offers-list">
            {loading ? <div className="offers-message">Loading offers...</div> : coupons.length === 0 ? <div className="offers-message"><strong>No offers yet</strong><span>Create your first coupon campaign to get started.</span></div> : coupons.map((coupon) => {
              const state = offerState(coupon);
              return <article className="offer-row" key={coupon.couponId}>
                <div className="offer-code"><span>{coupon.couponCode}</span><small>{coupon.description || "No description"}</small></div>
                <div><small>Discount</small><strong>{coupon.discountType === "PERCENTAGE" ? `${coupon.discountValue}%` : coupon.discountType === "PAIR_FIXED" ? `₹${coupon.discountValue} / pair` : `₹${coupon.discountValue}`}</strong></div>
                <div><small>Minimum spend</small><strong>₹{coupon.minimumOrderAmount || 0}</strong></div>
                <div><small>Valid until</small><strong>{new Date(coupon.validTo).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</strong></div>
                <span className={`offer-status ${state.toLowerCase()}`}>{state}</span>
                <div className="offer-actions"><button className="offer-action" onClick={() => editOffer(coupon)}>Edit</button><button className="offer-action" onClick={() => toggleActive(coupon)}>{coupon.isActive ? "Deactivate" : "Activate"}</button></div>
              </article>;
            })}
          </section>
        </> : section === "automatic-offer" ? <AdminAutomaticOffer /> : section === "products" ? <AdminProducts /> : section === "orders" ? <AdminOrders /> : section === "returns" ? <AdminReturns /> : section === "inventory" ? <AdminInventory /> : section === "customers" ? <AdminCustomers /> : section === "storefront" ? <AdminStorefront /> : section === "reviews" ? <AdminReviews /> : section === "notifications" ? <Notifications embedded onAdminNavigate={navigateSection} /> : <AdminEmailOutbox />}
      </main>
    </div>
  );
};

export default AdminDashboard;
