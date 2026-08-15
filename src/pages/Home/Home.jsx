import React from "react";
import { useSearchParams } from "react-router-dom";
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
