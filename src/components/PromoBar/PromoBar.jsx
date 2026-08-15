import React, { useCallback, useEffect, useState } from "react";
import "./PromoBar.css";
import { getActiveAutomaticOffer } from "../../services/api";

export const FALLBACK_MESSAGE =
  "Free shipping on orders of ₹500 or more  ·  30-day easy returns";

/**
 * The top banner strip.
 *
 * While an automatic offer is in force it shows that offer's message and cannot be dismissed: there
 * is no close control rendered at all, so there is nothing to click and nothing to remember. No
 * dismissal state is stored anywhere — not localStorage, not a cookie, not sessionStorage — which is
 * what makes the banner survive a refresh and every route change for as long as the offer is live.
 *
 * When no offer is in force it falls back to the existing shipping/returns line, and there the
 * existing close button stays: that is the design that was already shipped, and the brief's
 * non-dismissible requirement is about the offer banner.
 *
 * The message is rendered as a text node. The server strips markup from administrator input before
 * storing it, and this end never interprets HTML — an administrator cannot inject a script or a
 * link through the banner even if the sanitiser were bypassed.
 *
 * Layout shift: the strip keeps one line's height from first paint by rendering the fallback text
 * immediately and swapping the words when the offer arrives, so the page below it never moves.
 */
const PromoBar = () => {
  const [dismissed, setDismissed] = useState(false);
  const [offer, setOffer] = useState(null);

  const load = useCallback(() => {
    let active = true;
    getActiveAutomaticOffer()
      .then((response) => { if (active) setOffer(response?.active ? response : null); })
      // A failed lookup leaves the fallback message in place. A banner is not worth an error state,
      // and showing nothing would move the page.
      .catch(() => { if (active) setOffer(null); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const cancel = load();
    // An administrator editing the message is picked up by other sessions on their next normal data
    // refresh: a reload, or the tab regaining focus. `shades:offer-changed` covers the admin's own
    // session, where the save and the banner are the same page.
    const refresh = () => load();
    window.addEventListener("focus", refresh);
    window.addEventListener("shades:offer-changed", refresh);
    return () => {
      cancel();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("shades:offer-changed", refresh);
    };
  }, [load]);

  const offerActive = Boolean(offer);
  if (!offerActive && dismissed) return null;

  return (
    <div className={`promo-bar${offerActive ? " promo-bar-offer" : ""}`}
      data-offer-active={offerActive ? "true" : "false"}>
      <p role="status">{offerActive ? offer.bannerMessage : FALLBACK_MESSAGE}</p>
      {!offerActive && (
        <button className="promo-close" onClick={() => setDismissed(true)} aria-label="Close">
          ✕
        </button>
      )}
    </div>
  );
};

export default PromoBar;
