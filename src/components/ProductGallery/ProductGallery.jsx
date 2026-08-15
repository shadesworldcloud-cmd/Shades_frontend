import React, { useCallback, useMemo, useRef, useState } from "react";
import "./ProductGallery.css";

/**
 * The product photo gallery: one large image, a thumbnail strip, and Previous/Next.
 *
 * Every control is type="button". The gallery is rendered inside the product page, and a bare
 * <button> inside any enclosing <form> defaults to type="submit" — clicking a thumbnail would
 * submit the form and reload the page, which is precisely the "no gallery control causes a form
 * submission or page refresh" requirement.
 *
 * The component owns only which image is showing. Which images exist, and in what order, is decided
 * by the caller from the server's ordered gallery — so the order a customer sees is the order an
 * admin saved, not something re-derived here.
 */
export default function ProductGallery({ images, productName, badge }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [failed, setFailed] = useState({});
  const touchStartX = useRef(null);
  const frameRef = useRef(null);

  // Identity of the list, not the array reference. The parent rebuilds this array on every render
  // (it is derived with useMemo from the selected variant), so depending on the reference would
  // reset the customer's chosen photo on unrelated re-renders — every "add to bag" click, for one.
  const signature = useMemo(
    () => (images || []).map((image) => image.publicId || image.imageId || image.imageUrl).join("|"),
    [images]
  );

  // Reset during render, not in an effect.
  //
  // As `useEffect(() => setActiveIndex(0), [signature])` this was a race: an effect scheduled by an
  // earlier render could run AFTER a click and reset the photo the customer had just chosen. It
  // showed up as Next appearing to do nothing, intermittently. Adjusting state during render is
  // React's documented way to reset state when a prop changes — it happens before the click can
  // ever be observed, so there is no window in which it can undo one.
  const [lastSignature, setLastSignature] = useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    setActiveIndex(0);
  }

  const count = images?.length || 0;
  // Guards against the parent handing back a shorter list while an index is held — selecting a
  // variant with fewer photos than the last one, for instance.
  const safeIndex = count === 0 ? 0 : Math.min(activeIndex, count - 1);
  const active = count > 0 ? images[safeIndex] : null;

  const step = useCallback((delta) => {
    if (count < 2) return;
    // Wraps, so Next on the last photo returns to the first rather than dead-ending.
    setActiveIndex((current) => (Math.min(current, count - 1) + delta + count) % count);
  }, [count]);

  const onKeyDown = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    // Only once the gallery genuinely handles the key: otherwise this would swallow the arrow keys
    // a customer uses to scroll the page.
    if (count < 2) return;
    event.preventDefault();
    step(event.key === "ArrowLeft" ? -1 : 1);
  };

  const onTouchStart = (event) => { touchStartX.current = event.changedTouches[0]?.clientX ?? null; };
  const onTouchEnd = (event) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null) return;
    const travelled = (event.changedTouches[0]?.clientX ?? start) - start;
    // 40px, so a vertical scroll that drifts sideways is not read as a swipe.
    if (Math.abs(travelled) < 40) return;
    step(travelled < 0 ? 1 : -1);
  };

  if (count === 0) {
    // A product with no photography is a normal state, not an error. An empty frame keeps the
    // page's layout identical to a product that has one, so nothing shifts around it.
    return (
      <div className="pg-frame pg-frame-empty" data-testid="product-gallery-empty">
        <div className="pg-placeholder">SHADES WORLD</div>
        {badge}
      </div>
    );
  }

  const labelFor = (image, index) => image.altText?.trim() || `${productName} — photo ${index + 1} of ${count}`;

  return (
    <div className="pg" onKeyDown={onKeyDown} role="group" aria-roledescription="carousel"
      aria-label={`${productName} photos`} tabIndex={count > 1 ? 0 : -1} ref={frameRef}>
      <div className="pg-frame" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {/* The <img> stays mounted even when it fails to load, and the failure is reported
            alongside it rather than by replacing it. Unmounting it threw away the alt text (the
            only description a customer then had), removed the element a retry would repaint, and
            made the selected photo unreadable from the DOM — which is also how the variant specs
            check that the hero matches the chosen colourway. */}
        <img
          // Keyed by URL so switching photos swaps the element rather than mutating src on one
          // <img>, which would otherwise keep painting the previous photo until the new one
          // decoded — a visible flash of the wrong colourway when changing variant.
          key={active.imageUrl}
          className={failed[active.imageUrl] ? "pg-failed" : ""}
          src={active.imageUrl}
          alt={labelFor(active, safeIndex)}
          // The main photo is above the fold and is the page's largest contentful paint.
          // Lazy-loading it would delay exactly the image the customer came to see.
          loading="eager"
          decoding="async"
          onError={() => setFailed((current) => ({ ...current, [active.imageUrl]: true }))}
        />
        {failed[active.imageUrl] && (
          <p className="pg-error-note" role="status">This photo could not be loaded.</p>
        )}
        {badge}
        {count > 1 && (
          <>
            <button type="button" className="pg-nav pg-prev" onClick={() => step(-1)}
              aria-label="Previous photo">‹</button>
            <button type="button" className="pg-nav pg-next" onClick={() => step(1)}
              aria-label="Next photo">›</button>
            <span className="pg-count" aria-hidden="true">{safeIndex + 1} / {count}</span>
          </>
        )}
      </div>

      {/* Hidden from assistive tech and read out as text instead: "3 / 7" is meaningless spoken,
          and the thumbnail list below already exposes position through aria-current. */}
      {count > 1 && <p className="pg-live" aria-live="polite">Photo {safeIndex + 1} of {count}</p>}

      {count > 1 && (
        <ul className="pg-thumbs">
          {images.map((image, index) => (
            <li key={image.publicId || image.imageId || image.imageUrl}>
              <button type="button" className={index === safeIndex ? "active" : ""}
                aria-current={index === safeIndex ? "true" : undefined}
                aria-label={`Show photo ${index + 1} of ${count}`}
                onClick={() => setActiveIndex(index)}>
                {/* Thumbnails are below the main photo and mostly out of view on a phone, so they
                    load lazily. This is what stops a ten-image product fetching ten full-size
                    files the moment the page opens. */}
                <img src={image.imageUrl} alt="" loading="lazy" decoding="async" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
