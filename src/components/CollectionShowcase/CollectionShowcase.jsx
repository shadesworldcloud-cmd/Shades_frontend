import React from "react";
import "./CollectionShowcase.css";
import { Link } from "react-router-dom";

// These cards used to call setCategory("Polarized") / ("Blue Light") and link to the #shop anchor.
// Neither category exists in the catalogue and Home coerced any unknown value back to "All", so
// both were dead: the click appeared to filter and then quietly showed everything. They now point
// at real collections, which are the storefront categories the backend actually models.
const FEATURED = [
  { name: "Men", heading: "Men", blurb: "Structured silhouettes and understated metals.", background: "#2c2c2c", dark: false },
  { name: "Women", heading: "Women", blurb: "Sculptural shapes with a softer line.", background: "var(--bg-sand)", dark: true },
];

const CollectionShowcase = () => (
  <section className="collections" id="collections">
    <div className="container">
      <h2 className="collections-heading">Collections</h2>
      <div className="collections-grid">
        {FEATURED.map((item) => (
          <Link key={item.name} to={`/collections/${item.name.toLowerCase()}`} className="collection-card">
            <div className="collection-card-bg" style={{ background: item.background }} />
            <div className={`collection-card-content ${item.dark ? "dark-text" : ""}`}>
              <span className="collection-eyebrow">Explore</span>
              <h3>{item.heading}</h3>
              <p>{item.blurb}</p>
              <span className="collection-link">Shop {item.heading.toLowerCase()} →</span>
            </div>
          </Link>
        ))}
      </div>
      <Link to="/collections" className="collections-all-link">View all collections →</Link>
    </div>
  </section>
);

export default CollectionShowcase;
