import React from "react";
import "./Footer.css";
import BrandWordmark from "../BrandWordmark/BrandWordmark";
import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="footer" id="footer">
      <div className="footer-inner">
        <div className="footer-col footer-brand">
          <BrandWordmark light />
          <p className="footer-tagline">
            Distinctive eyewear for the bold, the curious and the individual.
          </p>
          <Link className="footer-story" to="/info/about">Our story →</Link>
        </div>

        <div className="footer-col">
          <h4>Shop</h4>
          <ul>
            <li><Link to="/shop">All eyewear</Link></li>
            <li><Link to="/collections/men">Men</Link></li>
            <li><Link to="/collections/women">Women</Link></li>
            <li><Link to="/collections/unisex">Unisex</Link></li>
          </ul>
        </div>

        <div className="footer-col">
          <h4>Help</h4>
          <ul>
            <li><Link to="/info/shipping">Shipping &amp; Delivery</Link></li>
            <li><Link to="/info/returns">Exchanges</Link></li>
            <li><Link to="/info/faq">FAQ</Link></li>
            <li><Link to="/info/size-guide">Size Guide</Link></li>
          </ul>
        </div>

        <div className="footer-col">
          <h4>Information</h4>
          <ul>
            <li><Link to="/info/about">About us</Link></li>
            <li><Link to="/info/contact">Contact us</Link></li>
            <li><Link to="/info/privacy">Privacy policy</Link></li>
            <li><Link to="/info/terms">Terms &amp; conditions</Link></li>
          </ul>
        </div>
      </div>

      <div className="footer-bottom">
        <p>&copy; 2026 Shades World Barcelona. All rights reserved.</p>
        <div><Link to="/info/privacy">Privacy</Link><Link to="/info/terms">Terms</Link></div>
      </div>
    </footer>
  );
};

export default Footer;
