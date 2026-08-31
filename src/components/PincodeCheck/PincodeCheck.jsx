import React, { useState } from "react";
import { checkPincodeServiceability } from "../../services/api";
import "./PincodeCheck.css";

/**
 * Pincode serviceability checker — lets a customer enter their pincode
 * on the product detail page to see if delivery is available and get
 * an estimated delivery time.
 */
const PincodeCheck = () => {
  const [pincode, setPincode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handleCheck = async (e) => {
    e.preventDefault();
    const cleaned = pincode.replace(/\D/g, "");
    if (cleaned.length !== 6) {
      setError("Please enter a valid 6-digit pincode");
      setResult(null);
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await checkPincodeServiceability(cleaned);
      const couriers = response?.data?.available_courier_companies || response?.data?.availableCourierCompanies || [];

      if (couriers.length === 0) {
        setError("Sorry, delivery is not available to this pincode.");
      } else {
        // Pick the cheapest courier for display
        const best = couriers.reduce((a, b) =>
          (Number(a.estimated_delivery_days || a.estimatedDeliveryDays) <
           Number(b.estimated_delivery_days || b.estimatedDeliveryDays)) ? a : b
        );
        setResult({
          available: true,
          estimatedDays: best.estimated_delivery_days || best.estimatedDeliveryDays,
          courierName: best.courier_name || best.courierName,
          etd: best.etd,
          courierCount: couriers.length,
        });
      }
    } catch (err) {
      setError("Unable to check delivery availability. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pincode-check">
      <form onSubmit={handleCheck} className="pincode-check-form">
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="Enter delivery pincode"
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

      {error && <p className="pincode-check-error">{error}</p>}

      {result?.available && (
        <div className="pincode-check-result">
          <p className="pincode-check-success">
            ✓ Delivery available to {pincode}
          </p>
          <p className="pincode-check-eta">
            Estimated delivery: {result.estimatedDays} business day{result.estimatedDays > 1 ? "s" : ""}
            {result.etd ? ` (by ${result.etd})` : ""}
          </p>
          <p className="pincode-check-courier">
            via {result.courierName}
            {result.courierCount > 1 ? ` (+${result.courierCount - 1} more option${result.courierCount > 2 ? "s" : ""})` : ""}
          </p>
        </div>
      )}
    </div>
  );
};

export default PincodeCheck;
