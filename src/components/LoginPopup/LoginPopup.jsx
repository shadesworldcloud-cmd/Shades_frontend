import React, { useState } from "react";
import "./LoginPopup.css";
import { assets } from "../../assets/assets";

const LoginPopup = ({ setShowLogin }) => {
  const [currState, setCurrState] = useState("Login");

  return (
    <div className="login-popup" onClick={() => setShowLogin(false)}>
      <form
        className="login-popup-container"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="login-popup-title">
          <h2>{currState}</h2>
          <button
            type="button"
            className="popup-close"
            onClick={() => setShowLogin(false)}
            aria-label="Close"
          >
            <img src={assets.cross_icon} alt="" />
          </button>
        </div>

        <div className="login-popup-inputs">
          {currState !== "Login" && (
            <input type="text" placeholder="Your name" required />
          )}
          <input type="email" placeholder="Email address" required />
          <input type="password" placeholder="Password" required />
        </div>

        <button type="submit" className="login-submit">
          {currState === "Sign Up" ? "Create account" : "Login"}
        </button>

        <div className="login-popup-condition">
          <input type="checkbox" id="terms" required />
          <label htmlFor="terms">
            I agree to the terms &amp; conditions
          </label>
        </div>

        {currState === "Login" ? (
          <p className="login-switch">
            Don't have an account?{" "}
            <span onClick={() => setCurrState("Sign Up")}>Sign up</span>
          </p>
        ) : (
          <p className="login-switch">
            Already have an account?{" "}
            <span onClick={() => setCurrState("Login")}>Login</span>
          </p>
        )}
      </form>
    </div>
  );
};

export default LoginPopup;
