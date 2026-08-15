// Persistence for the signed-out bag only. An authenticated bag already lives in the
// database and is restored by StoreContext's sign-in effect, so it is never written here —
// mirroring it to storage would leak one account's bag into the next session on a shared
// browser and would fight the server for authority.
//
// The stored shape is the same `${productId}:${variantId}` -> quantity map the context uses,
// so nothing has to be translated on the way back in. Prices and availability are deliberately
// NOT stored: they are re-derived from the live catalogue on restore, so a bag saved before a
// price change or a sell-out reflects today's catalogue rather than yesterday's.

const KEY = "shades_world_guest_cart";
const VERSION = 1;
// Long enough that a shopper returning the next day still has their bag, short enough that a
// forgotten bag on a shared machine does not linger for months.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const storage = () => {
  try {
    // Safari private mode and hardened browser settings make localStorage throw on access
    // rather than return null, so every entry point has to tolerate that.
    const candidate = window.localStorage;
    const probe = `${KEY}__probe`;
    candidate.setItem(probe, "1");
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return null;
  }
};

const isValidEntry = ([key, quantity]) =>
  typeof key === "string"
  && /^\d+:\d+$/.test(key)
  && Number.isInteger(quantity)
  && quantity > 0
  && quantity <= 999;

export const readGuestCart = () => {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== VERSION || typeof parsed.items !== "object" || parsed.items === null) {
      store.removeItem(KEY);
      return {};
    }
    if (!Number.isFinite(parsed.savedAt) || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      store.removeItem(KEY);
      return {};
    }
    // Drop anything malformed rather than the whole bag: a single corrupt line should not
    // cost the shopper the rest of their selection.
    return Object.fromEntries(Object.entries(parsed.items).filter(isValidEntry));
  } catch {
    // Unparseable payload: clear it so the next write starts from something coherent.
    try { store.removeItem(KEY); } catch { /* storage vanished mid-call */ }
    return {};
  }
};

export const writeGuestCart = (items) => {
  const store = storage();
  if (!store) return;
  try {
    const kept = Object.fromEntries(Object.entries(items || {}).filter(isValidEntry));
    if (Object.keys(kept).length === 0) {
      store.removeItem(KEY);
      return;
    }
    store.setItem(KEY, JSON.stringify({ version: VERSION, savedAt: Date.now(), items: kept }));
  } catch {
    // Quota exceeded or storage disabled mid-session: the in-memory bag still works.
  }
};

export const clearGuestCart = () => {
  const store = storage();
  if (!store) return;
  try { store.removeItem(KEY); } catch { /* nothing to clear */ }
};
