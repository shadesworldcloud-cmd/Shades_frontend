/**
 * How catalogue changes travel from the surfaces that cause them (the admin wizard, publish and
 * remove actions, inventory adjustments, a placed order) to the surfaces that display the
 * catalogue (StoreContext's product list, the cart quote).
 *
 * Two transports, because they reach different places:
 *   - a window event, for listeners in the SAME tab — the original mechanism;
 *   - a BroadcastChannel, for OTHER TABS of the same browser. Without it, a storefront tab opened
 *     before a product was published kept showing the old catalogue: the new product missing, and
 *     cards for since-removed products answering "Product not found" on click. A window event
 *     cannot cross tabs, and tab-focus events are not observable in every embedding — an explicit
 *     broadcast is deterministic.
 *
 * BroadcastChannel is guarded because jsdom (the unit-test DOM) does not implement it; every
 * browser this app targets does.
 */
const EVENT = "shades:products-changed";
const CHANNEL = "shades:catalogue";

export const announceCatalogueChanged = () => {
  window.dispatchEvent(new Event(EVENT));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage("changed");
    channel.close();
  }
};

/** Subscribes to both transports. Returns the unsubscribe function, for use as an effect cleanup. */
export const onCatalogueChanged = (handler) => {
  window.addEventListener(EVENT, handler);
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  if (channel) channel.onmessage = handler;
  return () => {
    window.removeEventListener(EVENT, handler);
    if (channel) channel.close();
  };
};
