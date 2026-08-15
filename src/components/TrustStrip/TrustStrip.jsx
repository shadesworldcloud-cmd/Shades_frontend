import React from "react";
import "./TrustStrip.css";

const features = [
  { icon: "☀️", title: "UV400 Protection", desc: "Full UVA & UVB blocking" },
  { icon: "◎", title: "Polarized Lenses", desc: "Reduced glare, true colour" },
  { icon: "✦", title: "Free Shipping", desc: "On orders of ₹500 or more" },
  { icon: "↺", title: "30-Day Returns", desc: "No questions asked" },
];

const TrustStrip = () => {
  return (
    <section className="trust-strip">
      <div className="container">
        <div className="trust-grid">
          {features.map((f, i) => (
            <div className="trust-item" key={i}>
              <span className="trust-icon">{f.icon}</span>
              <h4>{f.title}</h4>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TrustStrip;
