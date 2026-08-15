import React from "react";
import "./Hero.css";
import { assets } from "../../assets/assets";

const Hero = () => {
  return (
    <section className="hero">
      <div className="hero-image">
        <img src={assets.hero_img} alt="Shades World — from Barcelona to the world" />
      </div>
    </section>
  );
};

export default Hero;
