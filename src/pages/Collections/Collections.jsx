import { useContext, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { StoreContext } from "../../context/StoreContext";
import ProductGrid from "../../components/ProductGrid/ProductGrid";
import "./Collections.css";
import collectionMen from "../../assets/collections/collection-men.jpg";
import collectionWomen from "../../assets/collections/collection-women.jpg";
import collectionUnisex from "../../assets/collections/collection-unisex.jpg";

/**
 * Collections are the storefront categories. The backend has no separate collection entity —
 * CATEGORIES is the only product grouping it models — so inventing a second taxonomy here would
 * mean a name on this page that nothing in the catalogue could ever match. That is exactly what
 * the previous Home cards did: they pointed at "Polarized" and "Blue Light", neither of which
 * exists, so both silently fell back to the whole catalogue.
 */
// tone is painted under the photograph: it covers the download and any failure, so a tile is never
// a blank rectangle. Accessory has no photograph — the category is cases and cloths, and putting a
// model wearing sunglasses on it would advertise the wrong thing — so it keeps its flat bronze.
const COLLECTIONS = [
  { name: "Men", blurb: "Structured silhouettes and understated metals.",
    tone: "#2c2c2c", image: collectionMen, focus: "50% 22%" },
  { name: "Women", blurb: "Sculptural shapes with a softer line.",
    tone: "#6b5847", image: collectionWomen, focus: "50% 28%" },
  { name: "Unisex", blurb: "Frames that suit any face, any day.",
    tone: "#4a5c50", image: collectionUnisex, focus: "50% 26%" },
  { name: "Accessory", blurb: "Cases, cloths and care for the long term.", tone: "#8b6b43" },
];

export default function Collections() {
  const { collection } = useParams();
  const { product_list, productsLoading, productsError, refreshProducts } = useContext(StoreContext);

  const counts = useMemo(() => {
    const tally = {};
    for (const product of product_list) {
      for (const category of product.categories || []) {
        tally[category.categoryName] = (tally[category.categoryName] || 0) + 1;
      }
    }
    return tally;
  }, [product_list]);

  const active = COLLECTIONS.find((item) => item.name.toLowerCase() === String(collection || "").toLowerCase());

  if (collection && !active) {
    return (
      <main className="collections-page"><div className="container">
        <div className="collections-missing">
          <h1>Collection not found</h1>
          <p>We do not have a collection called “{collection}”.</p>
          <Link to="/collections" className="collections-back">← All collections</Link>
        </div>
      </div></main>
    );
  }

  if (active) {
    return (
      <main className="collections-page">
        <div className="container">
          <Link to="/collections" className="collections-back">← All collections</Link>
          <header className="collections-detail-header">
            <span>Collection</span>
            <h1>{active.name}</h1>
            <p>{active.blurb}</p>
          </header>
        </div>
        <ProductGrid category={active.name} />
      </main>
    );
  }

  return (
    <main className="collections-page"><div className="container">
      {/* No strapline under the title. The four tiles below carry their own names and blurbs, so a
          sentence explaining that there are four of them said nothing the page did not already show.
          The `.collections-header p` rule is kept because the single-collection header below still
          uses it for the active collection's blurb. */}
      <header className="collections-header">
        <span>Curated by us</span>
        <h1>Collections</h1>
      </header>

      {productsLoading && <p className="collections-status">Loading collections…</p>}

      {productsError && !productsLoading && (
        <div className="collections-status" role="alert">
          <p>Collections could not be loaded.</p>
          <button type="button" onClick={refreshProducts}>Try again</button>
        </div>
      )}

      {!productsLoading && !productsError && (
        <div className="collections-cards">
          {COLLECTIONS.map((item) => {
            const count = counts[item.name] || 0;
            return (
              <Link key={item.name} to={`/collections/${item.name.toLowerCase()}`} className="collection-tile">
                <div
                  className={`collection-tile-bg ${item.image ? "has-photo" : ""}`}
                  style={item.image
                    ? { backgroundColor: item.tone, backgroundImage: `url(${item.image})`, backgroundPosition: item.focus }
                    : { background: item.tone }}
                />
                <div className="collection-tile-body">
                  <span>Explore</span>
                  <h2>{item.name}</h2>
                  <p>{item.blurb}</p>
                  <small>{count === 0 ? "Nothing here yet" : `${count} style${count === 1 ? "" : "s"}`}</small>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div></main>
  );
}
