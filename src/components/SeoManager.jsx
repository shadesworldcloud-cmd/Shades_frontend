import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SITE_URL = (process.env.REACT_APP_SITE_URL || "https://www.shadesworldindia.com").replace(/\/$/, "");

const infoPages = {
  about: ["About Shades World India", "Learn about Shades World India and how we curate eyewear for men, women and unisex styles."],
  contact: ["Contact Shades World India", "Contact Shades World India for help with sunglasses, orders and delivery."],
  shipping: ["Shipping & Delivery", "Find delivery information for Shades World India online orders."],
  returns: ["Exchanges & Returns", "Read the Shades World India exchange and return information for online purchases."],
  faq: ["Frequently Asked Questions", "Answers to common questions about Shades World India products and orders."],
  "size-guide": ["Sunglasses Size Guide", "Find your fit with the Shades World India sunglasses size guide."],
  privacy: ["Privacy Policy", "Read how Shades World India handles customer information."],
  terms: ["Terms & Conditions", "Read the Shades World India terms and conditions."],
};

const collectionPages = {
  men: ["Men's Sunglasses", "Explore Shades World India sunglasses and eyewear styles for men."],
  women: ["Women's Sunglasses", "Explore Shades World India sunglasses and eyewear styles for women."],
  unisex: ["Unisex Sunglasses", "Explore versatile unisex sunglasses from Shades World India."],
  accessory: ["Eyewear Accessories", "Explore sunglasses cases, cloths and care accessories from Shades World India."],
};

function setMeta(selector, attributes) {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement(selector.startsWith("link") ? "link" : "meta");
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
}

export default function SeoManager() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (pathname.startsWith("/product/")) return;

    const privatePage = ["/signin", "/admin", "/account", "/cart", "/order",
      "/my-orders", "/wishlist", "/notifications"].some((path) =>
      pathname === path || pathname.startsWith(`${path}/`)) || pathname.startsWith("/payment/");
    let title = "Shades World India | Shop Sunglasses Online";
    let description = "Shop Shades World India sunglasses for men and women. Explore unisex and polarized styles, colour options and prices in INR.";
    if (pathname === "/shop") {
      title = "Shop Sunglasses Online | Shades World India";
      description = "Browse Shades World India sunglasses for men and women. Find unisex and polarized styles in a range of colours.";
    } else if (pathname === "/collections") {
      title = "Sunglasses Collections | Shades World India";
      description = "Explore the Shades World India sunglasses collections for men, women and unisex styles.";
    } else if (pathname.startsWith("/collections/")) {
      const collection = pathname.split("/")[2];
      if (collectionPages[collection]) [title, description] = collectionPages[collection];
      if (!title.includes("Shades World India")) title += " | Shades World India";
    } else if (pathname.startsWith("/info/")) {
      const page = pathname.split("/")[2];
      if (infoPages[page]) [title, description] = infoPages[page];
      if (!title.includes("Shades World India")) title += " | Shades World India";
    }

    const url = `${SITE_URL}${pathname === "/" ? "/" : pathname}`;
    document.title = title;
    setMeta('meta[name="description"]', { name: "description", content: description });
    setMeta('meta[name="robots"]', { name: "robots", content: privatePage ? "noindex,follow" : "index,follow" });
    setMeta('link[rel="canonical"]', { rel: "canonical", href: url });
    setMeta('meta[property="og:type"]', { property: "og:type", content: "website" });
    setMeta('meta[property="og:site_name"]', { property: "og:site_name", content: "Shades World India" });
    setMeta('meta[property="og:title"]', { property: "og:title", content: title });
    setMeta('meta[property="og:description"]', { property: "og:description", content: description });
    setMeta('meta[property="og:url"]', { property: "og:url", content: url });
    document.head.querySelector('meta[property="og:image"]')?.remove();
    document.head.querySelector("#product-jsonld")?.remove();
  }, [pathname]);

  return null;
}
