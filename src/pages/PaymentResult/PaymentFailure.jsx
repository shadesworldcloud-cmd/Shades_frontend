import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import "./PaymentResult.css";

const PaymentFailure = () => {
  const [params] = useSearchParams();
  const orderId = params.get("orderId");
  const reason = params.get("reason");

  return (
    <main className="payment-result failure">
      <div className="payment-result-card">
        <div className="payment-result-icon">&times;</div>
        <h1>Payment failed</h1>
        <p>{reason || "Your payment could not be processed. Please try again."}</p>
        {orderId && orderId !== "0" && (
          <p className="payment-detail">
            Order #{orderId} is still saved &mdash; you can retry payment from your orders page.
          </p>
        )}
        <div className="payment-result-actions">
          <Link to="/my-orders" className="btn-primary">Go to my orders</Link>
          <Link to="/shop" className="btn-secondary">Continue shopping</Link>
        </div>
      </div>
    </main>
  );
};

export default PaymentFailure;
