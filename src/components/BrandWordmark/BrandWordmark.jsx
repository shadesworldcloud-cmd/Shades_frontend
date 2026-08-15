import "./BrandWordmark.css";
import shadesWorldLogo from "../../assets/shades-world-logo.jpg";

const BrandWordmark = ({ light = false, compact = false }) => (
  <span className={`brand-wordmark${light ? " light" : ""}${compact ? " compact" : ""}`}>
    <img src={shadesWorldLogo} alt="Shades World" />
  </span>
);

export default BrandWordmark;
