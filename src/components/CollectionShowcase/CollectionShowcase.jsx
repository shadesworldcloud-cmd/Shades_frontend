import React from "react";
import "./CollectionShowcase.css";
import { Link } from "react-router-dom";
import useCollectionImages from "../../hooks/useCollectionImages";
import collectionMen from "../../assets/collections/collection-men.jpg";
import collectionWomen from "../../assets/collections/collection-women.jpg";
import collectionUnisex from "../../assets/collections/collection-unisex.jpg";

// These cards used to call setCategory("Polarized") / ("Blue Light") and link to the #shop anchor.
// Neither category exists in the catalogue and Home coerced any unknown value back to "All", so
// both were dead: the click appeared to filter and then quietly showed everything. They now point
// at real collections, which are the storefront categories the backend actually models.
// All four storefront categories, in the order the category strip lists them, so the home page and
// /collections present the same set. Men and Women alone used to sit here as two large cards while
// Unisex and Accessory existed only on /collections.
//
// `focus` is the background-position. It used to carry hand-tuned vertical percentages because the
// card was a wide short box (548x360) and `cover` cropped a horizontal band out of a portrait
// source — measured, that showed only 43.8% of each photograph's height. The card is now a portrait
// 2:3 frame, which is the native aspect of the Women and Unisex sources, so those two are shown
// whole and their focus value has nothing left to shift. Men is 4:5, so a 2:3 frame trims 16.7% off
// its WIDTH instead; the horizontal 50% is what centres that, and its vertical component is now
// inert. Kept rather than deleted so the numbers are not silently re-tuned if the frame changes.
//
// `tone` is kept and painted UNDER the photograph. It is what shows while the image is still
// downloading and if it ever fails, so the card is never a white hole. Accessory has no photograph
// on purpose — the category is cases and cloths, and a model wearing sunglasses would advertise the
// wrong thing — so it shows its flat bronze.
const FEATURED = [
  { name: "Men", heading: "Men", tone: "#2c2c2c", image: collectionMen, focus: "50% 22%" },
  { name: "Women", heading: "Women", tone: "#6b5847", image: collectionWomen, focus: "50% 28%" },
  { name: "Unisex", heading: "Unisex", tone: "#4a5c50", image: collectionUnisex, focus: "50% 26%" },
  { name: "Accessory", heading: "Accessory", tone: "#8b6b43" },
];

const CollectionShowcase = () => {
  // An administrator's upload wins over the bundled asset; see Admin → Storefront.
  const configuredImage = useCollectionImages();

  return (
  <section className="collections" id="collections">
    <div className="container">
      <h2 className="collections-heading">Collections</h2>
      <div className="collections-grid">
        {FEATURED.map((item) => {
          const uploaded = configuredImage(item.name);
          const image = uploaded || item.image;
          // An uploaded picture is of unknown proportions, so it is centred rather than given
          // `focus`: those percentages were measured against the bundled sources and mean nothing
          // for someone else's photograph.
          const position = uploaded ? "50% 50%" : (item.focus || "50% 50%");
          return (
          <Link key={item.name} to={`/collections/${item.name.toLowerCase()}`} className="collection-card">
            {/* The photograph and the words are now separate blocks stacked in flow, not text laid
                over an image. That is what lets the picture be shown with nothing on top of it: the
                scrim only ever existed to make white type legible against skin and sky, so moving
                the type off the photograph removes the reason for the scrim rather than trading
                legibility away. Measured: dark type on the page background is 17.40:1, against the
                10.5:1 the scrim managed, with 100% of the photograph now uncovered. */}
            <div className="collection-card-media">
              <div
                className={`collection-card-bg ${image ? "has-photo" : ""}`}
                style={image
                  ? { backgroundColor: item.tone, backgroundImage: `url(${image})`, backgroundPosition: position }
                  : { background: item.tone }}
              />
            </div>
            {/* Name only. The "Explore" eyebrow, the one-line blurb and the "Shop men →" link were
                removed on request. Losing the link costs nothing functionally: the whole card is
                already the Link, so the arrow was a second affordance for the same click, and the
                accessible name of the card is now simply the collection name. */}
            <div className="collection-card-content">
              <h3>{item.heading}</h3>
            </div>
          </Link>
          );
        })}
      </div>
    </div>
  </section>
  );
};

export default CollectionShowcase;
