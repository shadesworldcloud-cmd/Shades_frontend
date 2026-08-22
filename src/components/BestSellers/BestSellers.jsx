import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./BestSellers.css";
import ProductCard from "../ProductCard/ProductCard";
import { mapProduct } from "../../context/StoreContext";
import { getBestSellers } from "../../services/api";

/**
 * The Best Sellers carousel on the home page.
 *
 * The ranking is entirely the server's: this component never sorts, filters or scores anything.
 * It pages through whatever the API returned, in the order it returned it — see
 * ProductRepository.findBestSellers for what "best selling" actually means.
 *
 * Cards come from the shared mapProduct, so a Best Sellers card and the same product's card in the
 * discovery grid resolve to the same default variant, the same price and the same stock ceiling.
 */

/**
 * How many cards a row holds. These are not this component's numbers: they are the column counts
 * of .product-grid-list, so a Best Sellers card and a discovery grid card are the same size. The
 * thresholds are the far side of the grid's max-width media queries — CSS drops to three columns
 * at max-width:1250px, so four columns survive only from 1251px up.
 *
 * If the CSS breakpoints move, these must move with them: a row handed more cards than it has
 * columns clips the last ones.
 *
 * The count went from five to four. That is the whole point (five 323.5px cards plus their gaps
 * need 1721.5px of content and the container has 1372px), but it does change one behaviour: the
 * paging arrows appear from five products upwards instead of six, because five products no longer
 * fit in one group.
 */
const pageSizeFor = (width) => {
  if (width >= 1251) return 4;
  if (width >= 1051) return 3;
  if (width >= 431) return 2;
  return 1;
};

const viewportWidth = () => (typeof window === "undefined" ? 1280 : window.innerWidth);

export default function BestSellers({ limit = 20 }) {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("loading");
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(() => pageSizeFor(viewportWidth()));
  const liveRegion = useRef(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const ranking = await getBestSellers(limit);
      // The server nests the product; map it exactly as the storefront does.
      setEntries((ranking || []).filter((entry) => entry?.product).map((entry) => ({
        ...mapProduct(entry.product),
        soldQuantity: entry.soldQuantity,
      })));
      setStatus("ready");
    } catch (error) {
      setStatus("error");
    }
  }, [limit]);

  useEffect(() => { load(); }, [load]);

  // Re-measure on resize. The page index is kept as a page, not an offset, so widening the window
  // cannot strand the customer past the end — the clamp below handles it.
  useEffect(() => {
    const onResize = () => setPerPage(pageSizeFor(viewportWidth()));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const totalPages = Math.max(1, Math.ceil(entries.length / perPage));
  // Clamped rather than stored, so a resize that shrinks the page count can never leave `page`
  // pointing at a group that no longer exists.
  const currentPage = Math.min(page, totalPages - 1);
  const visible = useMemo(
    () => entries.slice(currentPage * perPage, currentPage * perPage + perPage),
    [entries, currentPage, perPage]
  );
  // Arrows are meaningless with a single group. The rule used to be written down as "not at five
  // products or fewer", but that five was only ever perPage's value, not an independent
  // requirement: the invariant is "more than one group", which is what this expression says and
  // which is unchanged by the move to four columns. The visible consequence is that arrows now
  // appear from five products upwards rather than six.
  //
  // Deliberately NOT `entries.length > Math.max(perPage, 5)` to keep the old literal threshold:
  // that would hide the arrows at exactly five curated products while the row still showed four,
  // leaving the fifth reachable by nothing at all. A slightly eager arrow beats an unreachable
  // product. A short final group renders fewer cards than there are tracks and does not stretch to
  // fill them — true before this change too, since 5 % 5 and 20 % 4 are equally likely to divide.
  const showArrows = entries.length > perPage;

  const goTo = (next) => {
    const clamped = Math.min(Math.max(next, 0), totalPages - 1);
    setPage(clamped);
    // Announced rather than focus-moved: moving focus to a card on every arrow press fights a
    // keyboard user who is arrowing through groups.
    if (liveRegion.current) liveRegion.current.textContent = `Showing group ${clamped + 1} of ${totalPages}`;
  };

  if (status === "ready" && entries.length === 0) return null;

  return (
    <section className="best-sellers" aria-labelledby="best-sellers-heading">
      <div className="container">
        <header className="best-sellers-header">
          <div>
            <span>Most loved</span>
            <h2 id="best-sellers-heading">Best Sellers</h2>
          </div>
          {showArrows && (
            <div className="best-sellers-arrows">
              <button type="button" aria-label="Show previous best sellers"
                disabled={currentPage === 0} onClick={() => goTo(currentPage - 1)}>←</button>
              <button type="button" aria-label="Show next best sellers"
                disabled={currentPage >= totalPages - 1} onClick={() => goTo(currentPage + 1)}>→</button>
            </div>
          )}
        </header>

        <p className="best-sellers-live" aria-live="polite" ref={liveRegion} />

        {/* The skeleton holds exactly the height a real row will occupy, so the rest of the home
            page does not jump downwards when the ranking arrives. */}
        {status === "loading" && (
          <div className="best-sellers-row" aria-hidden="true">
            {Array.from({ length: perPage }, (unused, index) => (
              <div className="best-sellers-skeleton" key={index} />
            ))}
          </div>
        )}

        {status === "error" && (
          <div className="best-sellers-error" role="alert">
            <p>Best Sellers could not be loaded.</p>
            <button type="button" onClick={load}>Try again</button>
          </div>
        )}

        {status === "ready" && (
          <div className="best-sellers-row">
            {visible.map((item) => (
              <ProductCard key={item._id} id={item._id} slug={item.slug} name={item.name} price={item.price}
                variantPrice={item.defaultVariantPrice} priceFrom={item.priceFrom}
                image={item.defaultVariantImage || item.image} hoverImage={item.hoverImage} color={item.color} isNew={item.isNew}
                variantId={item.defaultVariantId} stock={item.defaultVariantStock} available={item.available} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
