import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import {
  archiveAutomaticOffer, createAutomaticOffer, getAutomaticOffers,
  getStoreProducts, setAutomaticOfferActive, updateAutomaticOffer,
} from "../../services/api";
import useConfirmAction from "../../hooks/useConfirmAction";
import "./AdminAutomaticOffer.css";

const toLocalInput = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const blankOffer = () => {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 30);
  return {
    offerName: "", bannerMessage: "", requiredQuantity: "2", discountPerGroup: "",
    minimumOrderSubtotal: "0", scopeType: "ALL_PRODUCTS", productIds: [], categoryIds: [],
    startsAt: toLocalInput(now), endsAt: toLocalInput(end), isActive: false, priority: "0",
  };
};

/**
 * Administration for the automatic quantity offer.
 *
 * Its own component rather than another branch inside AdminDashboard: the coupon section there is
 * already a form, a list and four pieces of state inline, and a second one would make that file the
 * place every offer bug lives.
 *
 * Three things this screen is careful about, all of them server-enforced too:
 *
 *  - Only one offer can be live. Activating a second gets a 409 naming the one already live, and
 *    that message is shown as-is rather than translated into something vaguer.
 *  - Every save carries the version the form was loaded with. A second administrator who saved
 *    first wins, and this one is told to reload instead of silently overwriting them.
 *  - The preview under the amount fields is computed from the same formula the server uses, so an
 *    administrator can see what 7 units would earn before publishing anything.
 */
const AdminAutomaticOffer = () => {
  const { accessToken } = useAuth();
  const confirmAction = useConfirmAction();
  const [offers, setOffers] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blankOffer);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const page = await getAutomaticOffers(accessToken);
      setOffers(page.content || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    // The scope pickers need real catalogue references, and the server rejects an unknown id — so
    // the options come from the catalogue rather than being typed in by hand.
    let active = true;
    getStoreProducts()
      .then((page) => {
        if (!active) return;
        const content = page.content || [];
        setProducts(content.map((product) => ({
          productId: product.productId, name: product.productName || product.name,
        })));
        const byId = new Map();
        content.forEach((product) => (product.categories || []).forEach((category) => {
          const id = category.categoryId ?? category.id;
          if (id != null) byId.set(id, category.categoryName || category.name || `Category ${id}`);
        }));
        setCategories([...byId.entries()].map(([categoryId, name]) => ({ categoryId, name })));
      })
      .catch(() => { if (active) { setProducts([]); setCategories([]); } });
    return () => { active = false; };
  }, []);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const preview = useMemo(() => {
    const required = Number(form.requiredQuantity);
    const perGroup = Number(form.discountPerGroup);
    if (!Number.isInteger(required) || required < 2 || !(perGroup > 0)) return null;
    const sample = required * 3 + 1;
    const groups = Math.floor(sample / required);
    return { sample, groups, total: groups * perGroup, required, perGroup };
  }, [form.requiredQuantity, form.discountPerGroup]);

  /**
   * Mirrors the server's isUsableBannerMessage so an administrator learns immediately, in the form,
   * that their wording will not be shown. The server remains authoritative — the offer list's
   * `effectiveBannerMessage` is what customers actually get — so a drift between the two shows up as
   * a hint that disagrees with the list, never as a customer seeing placeholder text.
   */
  const bannerHint = useMemo(() => {
    const trimmed = form.bannerMessage.trim().replace(/\s{2,}/g, " ");
    if (!trimmed) {
      return preview
        ? `Customers will see: “Buy any ${preview.required} eligible products and get ${money(preview.perGroup)} off automatically for every complete ${preview.required === 2 ? "pair" : `group of ${preview.required}`}.”`
        : "Left blank, the banner is generated from the required quantity and discount below.";
    }
    const placeholders = ["message", "banner", "banner message", "text", "test", "testing", "todo",
      "tbd", "placeholder", "string", "offer", "offer message", "sample", "example", "n/a", "na",
      "none", "null", "undefined", "asdf", "xxx", "lorem ipsum", "dummy", "temp", "abc"];
    const unusable = trimmed.length < 12 || !trimmed.includes(" ")
      || placeholders.includes(trimmed.toLowerCase());
    return unusable
      ? "This does not read as an offer message, so the generated wording will be shown instead. "
        + "Write a full sentence of at least 12 characters to use your own."
      : null;
  }, [form.bannerMessage, preview]);

  const payload = () => ({
    offerName: form.offerName.trim(),
    bannerMessage: form.bannerMessage.trim() || null,
    requiredQuantity: Number(form.requiredQuantity),
    discountPerGroup: Number(form.discountPerGroup),
    minimumOrderSubtotal: Number(form.minimumOrderSubtotal || 0),
    scopeType: form.scopeType,
    productIds: form.scopeType === "SELECTED_PRODUCTS" ? form.productIds.map(Number) : [],
    categoryIds: form.scopeType === "SELECTED_CATEGORIES" ? form.categoryIds.map(Number) : [],
    startsAt: form.startsAt,
    endsAt: form.endsAt,
    isActive: form.isActive,
    priority: Number(form.priority || 0),
    version: editing ? editing.version : null,
  });

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setError(""); setNotice("");
    if (Number(form.requiredQuantity) < 2) {
      setError("The required quantity must be at least 2 — a group of one is not a quantity offer.");
      return;
    }
    if (!(Number(form.discountPerGroup) > 0)) {
      setError("The discount per group must be greater than zero.");
      return;
    }
    if (new Date(form.endsAt) <= new Date(form.startsAt)) {
      setError("The end date and time must be later than the start.");
      return;
    }
    setSaving(true);
    try {
      const saved = editing
        ? await updateAutomaticOffer(accessToken, editing.automaticOfferId, payload())
        : await createAutomaticOffer(accessToken, payload());
      setOffers((current) => editing
        ? current.map((item) => item.automaticOfferId === saved.automaticOfferId ? saved : item)
        : [saved, ...current]);
      setForm(blankOffer()); setEditing(null); setShowForm(false);
      setNotice(`"${saved.offerName}" was ${editing ? "updated" : "created"}.`);
      // The banner and any open cart read the offer from the server; tell them to re-read.
      window.dispatchEvent(new Event("shades:offer-changed"));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const edit = (offer) => {
    setForm({
      offerName: offer.offerName,
      bannerMessage: offer.bannerMessage || "",
      requiredQuantity: String(offer.requiredQuantity),
      discountPerGroup: String(offer.discountPerGroup),
      minimumOrderSubtotal: String(offer.minimumOrderSubtotal || 0),
      scopeType: offer.scopeType,
      productIds: (offer.productIds || []).map(String),
      categoryIds: (offer.categoryIds || []).map(String),
      startsAt: String(offer.startsAt).slice(0, 16),
      endsAt: String(offer.endsAt).slice(0, 16),
      isActive: Boolean(offer.isActive),
      priority: String(offer.priority ?? 0),
    });
    setEditing(offer); setShowForm(true); setError(""); setNotice("");
  };

  const toggleActive = (offer) => {
    const active = !offer.isActive;
    return confirmAction.ask({
      title: `${active ? "Activate" : "Deactivate"} this offer?`,
      body: <p><strong>{offer.offerName}</strong> will {active
        ? "start applying automatically to every eligible cart, and its banner will appear on the storefront"
        : "stop applying, and the storefront banner will return to the standard message"}.</p>,
      confirmLabel: active ? "Activate" : "Deactivate",
      busyLabel: "Saving…",
      run: async () => {
        setError("");
        const updated = await setAutomaticOfferActive(
          accessToken, offer.automaticOfferId, active, offer.version);
        setOffers((current) => current.map((item) =>
          item.automaticOfferId === offer.automaticOfferId ? updated : item));
        setNotice(`"${offer.offerName}" is now ${active ? "live" : "inactive"}.`);
        window.dispatchEvent(new Event("shades:offer-changed"));
      },
    });
  };

  const archive = (offer) => confirmAction.ask({
    title: "Archive this offer?",
    body: <p><strong>{offer.offerName}</strong> will be deactivated and hidden from the active list.
      Orders already placed under it keep their original discount — archiving never changes a
      historical total.</p>,
    confirmLabel: "Archive",
    busyLabel: "Archiving…",
    run: async () => {
      setError("");
      const updated = await archiveAutomaticOffer(accessToken, offer.automaticOfferId);
      setOffers((current) => current.map((item) =>
        item.automaticOfferId === offer.automaticOfferId ? updated : item));
      setNotice(`"${offer.offerName}" was archived.`);
      window.dispatchEvent(new Event("shades:offer-changed"));
    },
  });

  const multiSelect = (field) => (event) => update(field,
    [...event.target.selectedOptions].map((option) => option.value));

  return (
    <div className="auto-offer">
      {confirmAction.dialog}
      <div className="auto-offer-toolbar">
        <div>
          <p>One automatic offer can be live at a time. It needs no coupon code: while it is active
            the backend applies it to every eligible cart and order.</p>
        </div>
        <button onClick={() => { setShowForm((value) => !value); setEditing(null); setForm(blankOffer()); setError(""); }}>
          {showForm ? "Close form" : "+ New automatic offer"}
        </button>
      </div>

      {error && <div className="admin-alert error" role="alert">{error}</div>}
      {notice && <div className="admin-alert success" role="status">{notice}</div>}

      {showForm && (
        <form className="auto-offer-form" onSubmit={submit}>
          <div className="auto-offer-form-heading">
            <div>
              <span>{editing ? "Offer settings" : "New offer"}</span>
              <h2>{editing ? "Edit automatic offer" : "Create an automatic offer"}</h2>
            </div>
            <p>Fields marked * are required.</p>
          </div>

          <div className="auto-offer-grid">
            <label>Offer name *
              <input value={form.offerName} onChange={(e) => update("offerName", e.target.value)}
                maxLength="120" placeholder="Weekend pair offer" required />
            </label>
            <label>Banner message
              <input value={form.bannerMessage} onChange={(e) => update("bannerMessage", e.target.value)}
                maxLength="300" placeholder="Left blank, a message is generated from the numbers below"
                aria-describedby={bannerHint ? "auto-offer-banner-hint" : undefined} />
              {/* Told here rather than discovered on the storefront. An offer was once saved with the
                  banner message "message", which the shop then displayed across the top of every
                  page — this is the feedback that was missing. */}
              {bannerHint && (
                <small id="auto-offer-banner-hint" className="auto-offer-hint" role="status">
                  {bannerHint}
                </small>
              )}
            </label>
            <label>Required quantity per group *
              <input type="number" min="2" step="1" value={form.requiredQuantity}
                onChange={(e) => update("requiredQuantity", e.target.value)} required />
            </label>
            <label>Discount per complete group (₹) *
              <input type="number" min="0.01" step="0.01" value={form.discountPerGroup}
                onChange={(e) => update("discountPerGroup", e.target.value)} placeholder="500" required />
            </label>
            <label>Minimum eligible subtotal (₹)
              <input type="number" min="0" step="0.01" value={form.minimumOrderSubtotal}
                onChange={(e) => update("minimumOrderSubtotal", e.target.value)} />
            </label>
            <label>Eligible products *
              <select value={form.scopeType} onChange={(e) => update("scopeType", e.target.value)}>
                <option value="ALL_PRODUCTS">All products</option>
                <option value="SELECTED_PRODUCTS">Selected products</option>
                <option value="SELECTED_CATEGORIES">Selected categories</option>
              </select>
            </label>
            {form.scopeType === "SELECTED_PRODUCTS" && (
              <label className="auto-offer-scope">Products in scope *
                <select multiple size="6" value={form.productIds} onChange={multiSelect("productIds")}>
                  {products.map((product) => (
                    <option key={product.productId} value={String(product.productId)}>{product.name}</option>
                  ))}
                </select>
              </label>
            )}
            {form.scopeType === "SELECTED_CATEGORIES" && (
              <label className="auto-offer-scope">Categories in scope *
                <select multiple size="6" value={form.categoryIds} onChange={multiSelect("categoryIds")}>
                  {categories.map((category) => (
                    <option key={category.categoryId} value={String(category.categoryId)}>{category.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label>Starts *
              <input type="datetime-local" value={form.startsAt}
                onChange={(e) => update("startsAt", e.target.value)} required />
            </label>
            <label>Ends *
              <input type="datetime-local" value={form.endsAt}
                onChange={(e) => update("endsAt", e.target.value)} required />
            </label>
            <label>Priority
              <input type="number" step="1" value={form.priority}
                onChange={(e) => update("priority", e.target.value)} />
            </label>
            <label className="auto-offer-checkbox">
              <input type="checkbox" checked={form.isActive}
                onChange={(e) => update("isActive", e.target.checked)} />
              <span>Live now (only one automatic offer can be live)</span>
            </label>

            {preview && (
              <div className="auto-offer-preview" data-testid="auto-offer-preview">
                <span>How it works</span>
                <strong>{preview.sample} units ÷ {preview.required} = {preview.groups} complete {preview.groups === 1 ? "group" : "groups"}</strong>
                <p>{preview.groups} × {money(preview.perGroup)} = {money(preview.total)} total discount</p>
                <small>The {preview.sample - preview.groups * preview.required} unmatched unit receives no discount.</small>
              </div>
            )}
          </div>

          <div className="auto-offer-actions">
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); setForm(blankOffer()); }}>Cancel</button>
            <button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Publish offer"}</button>
          </div>
        </form>
      )}

      <section className="auto-offer-list">
        {loading ? <div className="auto-offer-message">Loading automatic offers…</div>
          : offers.length === 0 ? (
            <div className="auto-offer-message">
              <strong>No automatic offer yet</strong>
              <span>Create one to start discounting every eligible cart without a coupon code.</span>
            </div>
          ) : offers.map((offer) => (
            <article className="auto-offer-row" key={offer.automaticOfferId}>
              <div className="auto-offer-name">
                <span>{offer.offerName}</span>
                <small>{offer.effectiveBannerMessage}</small>
              </div>
              <div><small>Rule</small><strong>{money(offer.discountPerGroup)} per {offer.requiredQuantity}</strong></div>
              <div><small>Scope</small><strong>{offer.scopeType === "ALL_PRODUCTS" ? "All products"
                : offer.scopeType === "SELECTED_PRODUCTS" ? `${offer.productIds.length} products`
                : `${offer.categoryIds.length} categories`}</strong></div>
              <div><small>Runs until</small><strong>{new Date(offer.endsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</strong></div>
              <span className={`auto-offer-status ${offer.state.toLowerCase()}`}>{offer.state}</span>
              <div className="auto-offer-row-actions">
                <button onClick={() => edit(offer)} disabled={offer.state === "ARCHIVED"}>Edit</button>
                <button onClick={() => toggleActive(offer)} disabled={offer.state === "ARCHIVED"}>
                  {offer.isActive ? "Deactivate" : "Activate"}
                </button>
                <button onClick={() => archive(offer)} disabled={offer.state === "ARCHIVED"}>Archive</button>
              </div>
            </article>
          ))}
      </section>
    </div>
  );
};

export default AdminAutomaticOffer;
