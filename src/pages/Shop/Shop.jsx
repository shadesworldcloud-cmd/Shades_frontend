import { useContext } from "react";
import { useSearchParams } from "react-router-dom";
import { StoreContext } from "../../context/StoreContext";
import CategoryFilter from "../../components/CategoryFilter/CategoryFilter";
import ProductGrid from "../../components/ProductGrid/ProductGrid";
import "./Shop.css";

/**
 * The full catalogue on its own route. Deliberately thin: the category pills and the
 * discovery grid (search, brand/colour/price filters, sort, pagination) are the same
 * components Home renders, so Shop cannot drift from the storefront it belongs to.
 *
 * Category lives in the URL rather than in component state so a filtered shop can be linked,
 * refreshed and shared — which is the whole point of it being a route.
 */
const CATEGORIES = ["All", "Men", "Women", "Unisex", "Accessory"];

export default function Shop() {
  const { productsLoading, productsError, product_list } = useContext(StoreContext);
  const [params, setParams] = useSearchParams();
  const requested = params.get("category") || "All";
  const category = CATEGORIES.includes(requested) ? requested : "All";

  const setCategory = (next) => {
    const updated = new URLSearchParams(params);
    if (!next || next === "All") updated.delete("category");
    else updated.set("category", next);
    // Changing category invalidates the page number.
    updated.delete("page");
    setParams(updated, { replace: true });
  };

  return (
    <main className="shop-page">
      <div className="container">
        <header className="shop-header">
          <span>Every frame</span>
          <h1>Shop</h1>
          <p>The complete Shades World Barcelona collection — filter by category, colour, brand or price.</p>
        </header>

      </div>

      <CategoryFilter category={category} setCategory={setCategory} />
      <ProductGrid category={category} />

      {!productsLoading && !productsError && product_list.length === 0 && (
        <div className="container"><p className="shop-empty">No products are available just yet. Please check back shortly.</p></div>
      )}
    </main>
  );
}
