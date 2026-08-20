import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import {
  getAdminProducts,
  getCuratedBestSellers,
  getStorefrontSettings,
  resetHeroImage,
  saveCuratedBestSellers,
  uploadHeroImage,
} from "../../services/api";
import "./AdminStorefront.css";

/**
 * Home page control: which products are Best Sellers and in what order, and the hero image.
 *
 * The curated order is the whole point of the section, so it is edited as a list with explicit
 * Move up / Move down buttons rather than drag-and-drop. Buttons are keyboard-reachable and
 * announce themselves; a drag handle is neither, and this list is short enough that dragging buys
 * nothing.
 *
 * Nothing is saved as you rearrange: an order is only meaningful complete, and writing on every
 * nudge would publish half-finished sequences to the live home page. Save publishes; Discard
 * reloads what the server holds.
 */
const AdminStorefront = () => {
  const { accessToken } = useAuth();

  const [curated, setCurated] = useState([]);       // [{ productId, productName, ... }] in display order
  const [savedIds, setSavedIds] = useState([]);     // what the server currently holds
  const [missingIds, setMissingIds] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [addChoice, setAddChoice] = useState("");
  const [heroUrl, setHeroUrl] = useState("");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileInput = useRef(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [best, settings, products] = await Promise.all([
        getCuratedBestSellers(accessToken),
        getStorefrontSettings(),
        // The picker needs every product an admin could pin, including ones not publicly listed.
        getAdminProducts(accessToken),
      ]);
      const ordered = best?.curated || [];
      setCurated(ordered);
      setSavedIds(ordered.map((item) => item.productId));
      setMissingIds(best?.missingProductIds || []);
      setHeroUrl((settings?.heroImageUrl || "").trim());
      setCatalogue(products?.content || products || []);
    } catch (loadFailure) {
      setError(loadFailure.message || "The storefront settings could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const curatedIds = useMemo(() => curated.map((item) => item.productId), [curated]);
  const dirty = useMemo(
    () => curatedIds.length !== savedIds.length || curatedIds.some((id, index) => id !== savedIds[index]),
    [curatedIds, savedIds]
  );
  const addable = useMemo(
    () => catalogue.filter((item) => !curatedIds.includes(item.productId)),
    [catalogue, curatedIds]
  );

  const move = (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= curated.length) return;
    const next = [...curated];
    [next[index], next[target]] = [next[target], next[index]];
    setCurated(next);
    setNotice("");
  };
  const remove = (productId) => {
    setCurated((list) => list.filter((item) => item.productId !== productId));
    setNotice("");
  };
  const add = () => {
    const chosen = catalogue.find((item) => String(item.productId) === addChoice);
    if (!chosen) return;
    setCurated((list) => [...list, chosen]);
    setAddChoice("");
    setNotice("");
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await saveCuratedBestSellers(accessToken, curatedIds);
      const ordered = response?.curated || [];
      setCurated(ordered);
      setSavedIds(ordered.map((item) => item.productId));
      setMissingIds(response?.missingProductIds || []);
      setNotice(ordered.length
        ? `Best Sellers now shows these ${ordered.length} product${ordered.length === 1 ? "" : "s"}, in this order.`
        : "Curation cleared — Best Sellers is back to ranking by sales.");
    } catch (saveFailure) {
      setError(saveFailure.message || "The order could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const clearCuration = async () => {
    setCurated([]);
    setSaving(true);
    setError("");
    try {
      await saveCuratedBestSellers(accessToken, []);
      setSavedIds([]);
      setMissingIds([]);
      setNotice("Curation cleared — Best Sellers is back to ranking by sales.");
    } catch (clearFailure) {
      setError(clearFailure.message || "The curation could not be cleared.");
    } finally {
      setSaving(false);
    }
  };

  const pickHeroImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await uploadHeroImage(accessToken, file);
      setHeroUrl((response?.heroImageUrl || "").trim());
      setNotice("Home page image updated.");
    } catch (uploadFailure) {
      setError(uploadFailure.message || "The image could not be uploaded.");
    } finally {
      setSaving(false);
      // Clear the input so choosing the SAME file again still fires a change event.
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const revertHero = async () => {
    setSaving(true);
    setError("");
    try {
      await resetHeroImage(accessToken);
      setHeroUrl("");
      setNotice("Home page image reverted to the built-in banner.");
    } catch (revertFailure) {
      setError(revertFailure.message || "The image could not be reverted.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="storefront-admin">
      <div className="storefront-intro">
        <span>Home page</span>
        <h2>Storefront</h2>
        <p>What the home page shows: the Best Sellers line-up and its order, and the banner image.</p>
      </div>

      {error && <p className="storefront-error" role="alert">{error}</p>}
      {notice && <p className="storefront-notice" role="status">{notice}</p>}

      <div className="storefront-panel">
        <header>
          <div>
            <h3>Best Sellers</h3>
            <p>
              {savedIds.length
                ? "Showing exactly these products, in this order."
                : "Not curated — the section ranks products by units sold. Add one to take over."}
            </p>
          </div>
          {savedIds.length > 0 && (
            <button type="button" className="storefront-link" onClick={clearCuration} disabled={saving}>
              Rank by sales instead
            </button>
          )}
        </header>

        {busy ? <p className="storefront-empty">Loading…</p> : (
          <>
            {missingIds.length > 0 && (
              <p className="storefront-error" role="alert">
                {missingIds.length} pinned product{missingIds.length === 1 ? " no longer exists" : "s no longer exist"}
                {" "}({missingIds.join(", ")}) and {missingIds.length === 1 ? "is" : "are"} skipped on the storefront.
                Save to drop {missingIds.length === 1 ? "it" : "them"} from the list.
              </p>
            )}

            {curated.length === 0 ? (
              <p className="storefront-empty">No products pinned.</p>
            ) : (
              <ol className="storefront-order">
                {curated.map((item, index) => (
                  <li key={item.productId}>
                    <span className="storefront-position" aria-hidden="true">{index + 1}</span>
                    <div className="storefront-item">
                      <strong>{item.productName}</strong>
                      <small>{item.brand || "No brand"} · #{item.productId}{item.isActive === false ? " · inactive, hidden on the storefront" : ""}</small>
                    </div>
                    <div className="storefront-item-actions">
                      <button type="button" onClick={() => move(index, -1)} disabled={index === 0}
                              aria-label={`Move ${item.productName} up to position ${index}`}>↑</button>
                      <button type="button" onClick={() => move(index, 1)} disabled={index === curated.length - 1}
                              aria-label={`Move ${item.productName} down to position ${index + 2}`}>↓</button>
                      <button type="button" className="danger" onClick={() => remove(item.productId)}
                              aria-label={`Remove ${item.productName} from Best Sellers`}>Remove</button>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <div className="storefront-add">
              <label>
                Add a product
                <select value={addChoice} onChange={(event) => setAddChoice(event.target.value)}>
                  <option value="">Choose a product…</option>
                  {addable.map((item) => (
                    <option key={item.productId} value={item.productId}>
                      {item.productName}{item.brand ? ` — ${item.brand}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={add} disabled={!addChoice}>Add</button>
            </div>

            <footer className="storefront-actions">
              <button type="button" onClick={save} disabled={saving || !dirty}>
                {saving ? "Saving…" : "Save order"}
              </button>
              <button type="button" className="storefront-link" onClick={load} disabled={saving || !dirty}>
                Discard changes
              </button>
              {dirty && <small>Unsaved — the storefront still shows the previous order.</small>}
            </footer>
          </>
        )}
      </div>

      <div className="storefront-panel">
        <header>
          <div>
            <h3>Home page image</h3>
            <p>Replaces the banner across the top of the home page. JPEG, PNG or GIF.</p>
          </div>
        </header>
        <div className="storefront-hero">
          <div className="storefront-hero-preview">
            {heroUrl
              ? <img src={heroUrl} alt="Current home page banner" />
              : <p className="storefront-empty">Using the built-in banner.</p>}
          </div>
          <div className="storefront-hero-actions">
            <label className="storefront-file">
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/gif"
                     onChange={pickHeroImage} disabled={saving} />
              <span>{saving ? "Uploading…" : "Upload an image"}</span>
            </label>
            {heroUrl && (
              <button type="button" className="storefront-link" onClick={revertHero} disabled={saving}>
                Revert to the built-in banner
              </button>
            )}
            <small>The banner is a wide strip — around 1920×818 shows without cropping.</small>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AdminStorefront;
