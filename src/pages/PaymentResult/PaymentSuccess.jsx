import React, { useContext, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { StoreContext } from "../../context/StoreContext";
import "./PaymentResult.css";

const PaymentSuccess = () => {
  const [params] = useSearchParams();
  const orderId = params.get("orderId");
  const txnid = params.get("txnid");
  const { clearCartState } = useContext(StoreContext);
  const cleared = useRef(false);

  useEffect(() => {
    // Clear the cart once — stock was already deducted server-side when the order was placed.
    if (!cleared.current) {
      cleared.current = true;
      clearCartState();
    }
  }, [clearCartState]);

  return (
    <main className="payment-result success">
      <div className="payment-result-card">
        <div className="payment-result-icon">&#10003;</div>
        <h1>Payment successful</h1>
        <p>Your order has been confirmed and is being processed.</p>
        {orderId && <p className="payment-detail">Order #{orderId}</p>}
        {txnid && <p className="payment-detail secondary">Transaction: {txnid}</p>}
        <div className="payment-result-actions">
          <Link to="/my-orders" className="btn-primary">View my orders</Link>
          <Link to="/shop" className="btn-secondary">Continue shopping</Link>
        </div>
      </div>
    </main>
  );
};

export default PaymentSuccess;
