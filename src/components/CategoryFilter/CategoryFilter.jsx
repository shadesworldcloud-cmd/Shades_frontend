import React, { useContext } from "react";
import "./CategoryFilter.css";
import { StoreContext } from "../../context/StoreContext";

const CategoryFilter = ({ category, setCategory }) => {
  const { categories } = useContext(StoreContext);
  return (
    <section className="category-strip" id="shop">
      <div className="container">
        <h2 className="section-heading">Our eyewear</h2>
        <div className="category-pills">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              aria-pressed={category === cat}
              className={`category-pill ${category === cat ? "active" : ""}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};

export default CategoryFilter;
