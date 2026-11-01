import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import "./Home.css";
import Hero from "../../components/Hero/Hero";
import BestSellers from "../../components/BestSellers/BestSellers";
import CategoryFilter from "../../components/CategoryFilter/CategoryFilter";
import ProductGrid from "../../components/ProductGrid/ProductGrid";
import CollectionShowcase from "../../components/CollectionShowcase/CollectionShowcase";
import TrustStrip from "../../components/TrustStrip/TrustStrip";

const Home = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedCategory = searchParams.get("category") || "All";
  const category = ["All", "Men", "Women", "Unisex", "Accessory"].includes(requestedCategory) ? requestedCategory : "All";
  const setCategory = (value) => {
    const next = new URLSearchParams(searchParams);
    value === "All" ? next.delete("category") : next.set("category", value);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="home">
      <Hero />
      <section className="home-intro" aria-labelledby="home-intro-title">
        <div className="container home-intro-inner">
          <p className="home-intro-eyebrow">Sunglasses and eyewear in India</p>
          <h1 id="home-intro-title">Shades World India</h1>
          <p>Explore sunglasses for men, women and unisex styles. Compare colours, see product details and shop the collection online.</p>
          <div className="home-intro-links">
            <Link to="/shop">Shop sunglasses</Link>
            <Link to="/collections">Explore collections</Link>
          </div>
        </div>
      </section>
      {/* Immediately above the All/Men/Women/Unisex/Accessory controls, as specified. It renders
          nothing at all when the ranking is empty, so a fresh catalogue with no sales does not
          leave a headed but empty band between the hero and the filters. */}
      <BestSellers />
      <CategoryFilter category={category} setCategory={setCategory} />
      <ProductGrid category={category} />
      <CollectionShowcase />
      <TrustStrip />
    </div>
  );
};

export default Home;
