import React, { useEffect, useState } from "react";
import "./Hero.css";
import { assets } from "../../assets/assets";
import { getStorefrontSettings } from "../../services/api";

/**
 * The home page banner.
 *
 * The image is whatever an administrator uploaded, falling back to the bundled asset. The bundled
 * one is rendered immediately and swapped only once a configured URL actually arrives, so a slow or
 * failing settings call shows the default banner rather than an empty box — this is the first thing
 * on the page and it must never be blank.
 *
 * Still an <img> rather than a CSS background: the 1920x818 banner relies on object-fit: cover
 * inside an aspect-ratio box (see Hero.css), and it carries alt text.
 */
const Hero = () => {
  const [heroImage, setHeroImage] = useState(assets.hero_img);

  useEffect(() => {
    let active = true;
    getStorefrontSettings()
      .then((settings) => {
        const url = settings?.heroImageUrl;
        // Blank is a real stored value meaning "reverted to the default" — see clearHeroImage on
        // the server — so it must not be treated as a URL.
        if (active && url && url.trim()) setHeroImage(url.trim());
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <section className="hero">
      <div className="hero-image">
        <img
          src={heroImage}
          alt="Shades World — from Barcelona to the world"
          /* A configured image that 404s (deleted from the CDN, say) falls back rather than
             leaving a broken-image icon across the top of the home page. */
          onError={() => setHeroImage(assets.hero_img)}
        />
      </div>
    </section>
  );
};

export default Hero;
