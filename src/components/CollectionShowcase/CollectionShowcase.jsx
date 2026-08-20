import React from "react";
import "./CollectionShowcase.css";
import { Link } from "react-router-dom";
import collectionMen from "../../assets/collections/collection-men.jpg";
import collectionWomen from "../../assets/collections/collection-women.jpg";

// These cards used to call setCategory("Polarized") / ("Blue Light") and link to the #shop anchor.
// Neither category exists in the catalogue and Home coerced any unknown value back to "All", so
// both were dead: the click appeared to filter and then quietly showed everything. They now point
// at real collections, which are the storefront categories the backend actually models.
// Each card is now a photograph rather than a flat colour. `focus` is the background-position: the
// sources are portrait and the card is a wide short box, so `cover` crops a horizontal band out of
// the middle — left at the default 50% that band lands on the torso and decapitates the model. The
// percentages below put the sunglasses (the product) inside the crop at every card size.
//
// `tone` is kept and painted UNDER the photograph. It is what shows while the image is still
// downloading and if it ever fails, so the card is never a white hole — and for Men it preserves the
// dark character the flat #2c2c2c gave it.
const FEATURED = [
  { name: "Men", heading: "Men", blurb: "Structured silhouettes and understated metals.",
    tone: "#2c2c2c", image: collectionMen, focus: "50% 22%" },
  { name: "Women", heading: "Women", blurb: "Sculptural shapes with a softer line.",
    tone: "#6b5847", image: collectionWomen, focus: "50% 28%" },
];

const CollectionShowcase = () => (
  <section className="collections" id="collections">
    <div className="container">
      <h2 className="collections-heading">Collections</h2>
      <div className="collections-grid">
        {FEATURED.map((item) => (
          <Link key={item.name} to={`/collections/${item.name.toLowerCase()}`} className="collection-card">
            <div
              className="collection-card-bg has-photo"
              style={{ backgroundColor: item.tone, backgroundImage: `url(${item.image})`, backgroundPosition: item.focus }}
            />
            <div className="collection-card-content">
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
