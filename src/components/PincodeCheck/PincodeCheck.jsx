import React, { useEffect, useState } from "react";
import {
  FALLBACK_MAX_DAYS, FALLBACK_MIN_DAYS, fetchDeliveryEstimate, formatDeliveryRange,
  isIndianPincode, lastDeliveryPincode, rememberDeliveryPincode,
} from "../../services/deliveryEstimate";
import "./PincodeCheck.css";

/**
 * Pincode delivery checker on the product page. Shows the expected delivery date(s) from
 * Shiprocket via the server's /shiprocket/delivery-estimate endpoint. The pincode is remembered
 * for the session so checkout and other product pages show the same estimate.
 */
const PincodeCheck = () => {
  const [pincode, setPincode] = useState(() => lastDeliveryPincode());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const check = async (value) => {
    if (!isIndianPincode(value)) {
      setError("Please enter a valid 6-digit pincode");
      setResult(null);
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    const estimate = await fetchDeliveryEstimate(value);
    setLoading(false);
    if (estimate?.serviceable === false) {
      setError(`Sorry, we don't deliver to ${value} yet.`);
      return;
    }
    rememberDeliveryPincode(value);
    setResult({ ...estimate, checkedPincode: value });
  };

  // A pincode remembered from earlier in the session is checked straight away.
  useEffect(() => {
    if (isIndianPincode(pincode)) check(pincode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCheck = (event) => {
    event.preventDefault();
    check(pincode.replace(/\D/g, ""));
  };

  const confirmed = result && result.source !== "FALLBACK";

  return (
    <div className="pincode-check">
      <form onSubmit={handleCheck} className="pincode-check-form">
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="Enter delivery pincode"
          aria-label="Delivery pincode"
          value={pincode}
          onChange={(e) => {
            setPincode(e.target.value.replace(/\D/g, ""));
            setError("");
            setResult(null);
          }}
          className="pincode-check-input"
        />
        <button type="submit" disabled={loading} className="pincode-check-btn">
          {loading ? "Checking..." : "Check"}
        </button>
      </form>

      {error && <p className="pincode-check-error" role="alert">{error}</p>}

      {result && (
        <div className="pincode-check-result" data-testid="pincode-check-result">
          <p className="pincode-check-success">✓ Delivery available to {result.checkedPincode}</p>
          <p className="pincode-check-eta">
            {confirmed ? "Expected delivery" : "Usually delivered"}: <strong>{formatDeliveryRange(result)}</strong>
          </p>
          <p className="pincode-check-courier">
            {confirmed
              ? `via ${result.courierName || "our courier partners"}${result.courierCount > 1 ? ` (+${result.courierCount - 1} more option${result.courierCount > 2 ? "s" : ""})` : ""}`
              : `We couldn't confirm the courier date right now — standard delivery is ${FALLBACK_MIN_DAYS}–${FALLBACK_MAX_DAYS} business days after dispatch.`}
          </p>
        </div>
      )}
    </div>
  );
};

export default PincodeCheck;
