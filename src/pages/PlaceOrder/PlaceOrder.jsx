import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import "./PlaceOrder.css";
import { StoreContext, resolveCartLines } from "../../context/StoreContext";
import { useAuth } from "../../context/AuthContext";
import { createAddress, createOrder, getAddresses, processMockPayment } from "../../services/api";
import { announceCatalogueChanged } from "../../services/catalogueEvents";
import { pincodeError, sanitisePincode } from "../../services/pincode";
import { phoneError } from "../../services/phone";
import { Link, useNavigate } from "react-router-dom";

const emptyAddress = {
  recipientName: "", phoneNumber: "", addressLine1: "", addressLine2: "",
  city: "", state: "", pincode: "", country: "India",
};

const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const addBusinessDays = (start, days) => {
  const result = new Date(start); let remaining = days;
  while (remaining > 0) { result.setDate(result.getDate() + 1); if (![0, 6].includes(result.getDay())) remaining -= 1; }
  return result;
};
const shortDate = (value) => value.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

const PlaceOrder = () => {
  const { accessToken } = useAuth();
  const { cartItems, product_list, productsLoading, productsError, getTotalCartAmount, appliedOffer, clearCartState, getCartCount, cartSyncing, quote, quoteLoading } = useContext(StoreContext);
  const navigate = useNavigate();
  const [addresses, setAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [useNewAddress, setUseNewAddress] = useState(false);
  const [address, setAddress] = useState(emptyAddress);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [pendingOrderId, setPendingOrderId] = useState(null);
  // Generated once for the life of this checkout page. crypto.randomUUID is unavailable on some
  // older mobile browsers, so a timestamp-and-random fallback keeps the guarantee rather than
  // dropping the key and silently allowing a duplicate order.
  const idempotencyKeyRef = useRef(null);
  if (idempotencyKeyRef.current === null) {
    idempotencyKeyRef.current = typeof crypto !== "undefined" && crypto.randomUUID
      ? `co-${crypto.randomUUID()}`
      : `co-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }

  useEffect(() => {
    let active = true;
    getAddresses(accessToken)
      .then((values) => {
        if (!active) return;
        setAddresses(values || []);
        const preferred = values?.find((value) => value.isDefault) || values?.[0];
        if (preferred) setSelectedAddressId(String(preferred.addressId));
        else setUseNewAddress(true);
      })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoadingAddresses(false); });
    return () => { active = false; };
  }, [accessToken]);

  // Checkout shows only server figures. The bag may fall back to a client-side subtotal while the
  // quote is in flight; this page will not submit at all until the quote is here, because the number
  // it sends as expectedTotalAmount has to be the server's own — order creation compares the two and
  // refuses on any difference, which is what guarantees the customer is never charged an amount they
  // did not see.
  const priced = Boolean(quote);
  const subtotal = priced ? Number(quote.subtotal) : getTotalCartAmount();
  const discount = priced ? Number(quote.discount) : 0;
  const tax = priced ? Number(quote.taxAmount) : 0;
  const shipping = priced ? Number(quote.shippingAmount) : 0;
  const estimatedTotal = priced ? Number(quote.totalAmount) : subtotal;
  const offerQuote = quote?.automaticOffer;
  const automaticApplied = quote?.appliedPromotion === "AUTOMATIC_OFFER";
  const itemCount = getCartCount();
  // The same resolver the bag and the badge use: an unresolvable line is reviewed as such
  // rather than vanishing from a checkout whose own summary still counts it.
  const orderLines = useMemo(() => resolveCartLines(cartItems, product_list), [cartItems, product_list]);
  const unavailableLines = orderLines.filter((line) => !line.resolved);
  const catalogueBlocked = orderLines.length > 0 && product_list.length === 0 && (productsLoading || Boolean(productsError));
  const selectedAddress = useNewAddress ? address
    : addresses.find((item) => String(item.addressId) === selectedAddressId);
  const deliveryStart = shortDate(addBusinessDays(new Date(), 3));
  const deliveryEnd = shortDate(addBusinessDays(new Date(), 5));
  // Only validated for a new address; a saved one was already validated server-side when stored.
  const newAddressPincodeError = useNewAddress ? pincodeError(address.pincode, address.country) : "";
  const newAddressPhoneError = useNewAddress ? phoneError(address.phoneNumber) : "";
  const canSubmit = useMemo(() => itemCount > 0 && !submitting && !loadingAddresses && !cartSyncing
    && priced && !quoteLoading
    && unavailableLines.length === 0 && !catalogueBlocked && !newAddressPincodeError && !newAddressPhoneError
    && reviewConfirmed && (useNewAddress || selectedAddressId),
  [itemCount, submitting, loadingAddresses, cartSyncing, priced, quoteLoading, unavailableLines.length, catalogueBlocked, newAddressPincodeError, newAddressPhoneError, reviewConfirmed, useNewAddress, selectedAddressId]);

  useEffect(() => { setReviewConfirmed(false); }, [estimatedTotal, itemCount]);

  const changeAddress = (field) => (event) => {
    setReviewConfirmed(false);
    setAddress((current) => ({ ...current, [field]: event.target.value }));
  };
  // Sanitised on the way in rather than validated on the way out, so typed letters and pasted
  // junk simply never enter the field. Kept as a string so a leading zero survives.
  const changePincode = (event) => {
    setReviewConfirmed(false);
    const digits = sanitisePincode(event.target.value, address.country);
    setAddress((current) => ({ ...current, pincode: digits }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true); setError("");
    let createdOrder = pendingOrderId ? { orderId: pendingOrderId } : null;
    try {
      if (!createdOrder) {
        let shippingAddressId = Number(selectedAddressId);
        if (useNewAddress) {
          const savedAddress = await createAddress(accessToken, {
            ...address, addressType: "SHIPPING", isDefault: addresses.length === 0,
          });
          shippingAddressId = savedAddress.addressId;
          setAddresses((current) => [savedAddress, ...current]);
          setSelectedAddressId(String(savedAddress.addressId));
          setUseNewAddress(false);
        }
        createdOrder = await createOrder(accessToken, {
          shippingAddressId,
          billingAddressId: shippingAddressId,
          couponCode: appliedOffer?.couponCode || null,
          expectedTotalAmount: Number(estimatedTotal.toFixed(2)),
          // One key per checkout attempt, held in a ref so a retry after an interrupted payment
          // reuses it. The server returns the original order rather than placing a second one, so
          // the offer cannot be applied twice and stock cannot be deducted twice.
          idempotencyKey: idempotencyKeyRef.current,
        });
        setPendingOrderId(createdOrder.orderId);
      }
      await processMockPayment(accessToken, createdOrder.orderId);
      setPendingOrderId(null);
      clearCartState();
      // The order deducted stock server-side, so every cached quantity in product_list is now
      // stale — without this the shopper sees the pre-purchase stock until a full page reload,
      // and the Add buttons keep offering units that no longer exist.
      announceCatalogueChanged();
      navigate("/my-orders", { replace: true, state: { checkoutComplete: true, orderId: createdOrder.orderId } });
    } catch (requestError) {
      setError(createdOrder
        ? `Order #${createdOrder.orderId} was created, but payment confirmation was interrupted: ${requestError.message}. Use the retry button below; you will not be charged twice.`
        : requestError.message);
      // A rejected order is usually a stock rejection, and the quantities on screen are exactly
      // what the shopper needs corrected before retrying. Refetch so the bag shows real stock.
      if (!createdOrder) announceCatalogueChanged();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="place-order-page">
      <div className="container">
        <Link to="/cart" className="back-link">← Back to bag</Link>
        <h1 className="checkout-title">Checkout</h1>

        <form className="checkout-layout" onSubmit={submit}>
          <div className="checkout-left">
            <h2>Delivery information</h2>
            {loadingAddresses && <p className="checkout-note">Loading saved addresses…</p>}
            {!loadingAddresses && addresses.length > 0 && (
              <div className="saved-addresses">
                {addresses.map((saved) => (
                  <label className={`saved-address ${!useNewAddress && selectedAddressId === String(saved.addressId) ? "selected" : ""}`} key={saved.addressId}>
                    <input type="radio" name="deliveryAddress" checked={!useNewAddress && selectedAddressId === String(saved.addressId)}
                      onChange={() => { setReviewConfirmed(false); setUseNewAddress(false); setSelectedAddressId(String(saved.addressId)); }} />
                    <span><strong>{saved.recipientName}</strong>{saved.isDefault && <em>Default</em>}<br />
                      {saved.addressLine1}{saved.addressLine2 && `, ${saved.addressLine2}`}<br />
                      {saved.city}, {saved.state} {saved.pincode}<br />{saved.country}{saved.phoneNumber && ` · ${saved.phoneNumber}`}</span>
                  </label>
                ))}
                <button type="button" className="new-address-toggle" onClick={() => { setReviewConfirmed(false); setUseNewAddress(true); }}>+ Use a new address</button>
              </div>
            )}

            {useNewAddress && (
              <div className="new-address-form">
                <input value={address.recipientName} onChange={changeAddress("recipientName")} type="text" placeholder="Recipient name" maxLength="255" required />
                {/* inputMode="numeric" for a phone keypad; never type="number", which accepts
                    "e", "." and "-" and can drop a leading zero on paste. */}
                <input value={address.phoneNumber} onChange={changeAddress("phoneNumber")} type="tel" inputMode="numeric" autoComplete="tel" placeholder="10-digit mobile number" maxLength="20"
                  aria-invalid={Boolean(newAddressPhoneError)} aria-describedby={newAddressPhoneError ? "checkout-phone-error" : undefined} />
                {newAddressPhoneError && <small id="checkout-phone-error" className="checkout-field-error" role="alert">{newAddressPhoneError}</small>}
                <input value={address.addressLine1} onChange={changeAddress("addressLine1")} type="text" placeholder="Street address" maxLength="255" required />
                <input value={address.addressLine2} onChange={changeAddress("addressLine2")} type="text" placeholder="Apartment, suite, etc. (optional)" maxLength="255" />
                <div className="field-row">
                  <input value={address.city} onChange={changeAddress("city")} type="text" placeholder="City" maxLength="100" required />
                  <input value={address.state} onChange={changeAddress("state")} type="text" placeholder="State" maxLength="100" required />
                </div>
                <div className="field-row">
                  <input value={address.pincode} onChange={changePincode} type="text" inputMode="numeric"
                    autoComplete="postal-code" pattern="[0-9]*" placeholder="PIN code"
                    aria-label="PIN code"
                    aria-invalid={Boolean(newAddressPincodeError)} aria-describedby={newAddressPincodeError ? "checkout-pincode-error" : undefined}
                    required />
                  {newAddressPincodeError && <small id="checkout-pincode-error" className="checkout-field-error" role="alert">{newAddressPincodeError}</small>}
                  <input value={address.country} onChange={changeAddress("country")} type="text" placeholder="Country" maxLength="100" required />
                </div>
                {addresses.length > 0 && <button type="button" className="new-address-toggle" onClick={() => { setReviewConfirmed(false); setUseNewAddress(false); }}>Use a saved address</button>}
              </div>
            )}

            <section className="checkout-review-section" aria-labelledby="checkout-items-heading">
              <div className="checkout-section-heading"><h2 id="checkout-items-heading">Items in this order</h2><Link to="/cart">Edit bag</Link></div>
              {catalogueBlocked && <p className="checkout-note" role="status">{productsLoading
                ? "Loading the items in your bag…"
                : "The catalogue could not be loaded, so these items cannot be priced. Return to your bag and try again."}</p>}
              {!catalogueBlocked && <div className="checkout-review-items">{orderLines.map((line) => (line.resolved ? (
                <article key={line.key} className="checkout-review-item">
                  <img src={line.image} alt="" />
                  <div><strong>{line.product.name}</strong><span>{line.color}{line.variant?.sku && ` · ${line.variant.sku}`}</span><small>Quantity {line.quantity} × {money(line.price)}</small></div>
                  <b>{money(line.price * line.quantity)}</b>
                </article>
              ) : (
                <article key={line.key} className="checkout-review-item checkout-review-unavailable">
                  <span className="checkout-review-no-image" aria-hidden="true">SW</span>
                  <div><strong>{line.title}</strong><span>{line.unavailableReason}{line.variantId ? ` · ref ${line.variantId}` : ""}</span><small>Quantity {line.quantity} · not included in this order</small></div>
                  <b>—</b>
                </article>
              )))}</div>}
              {unavailableLines.length > 0 && <p className="checkout-error" role="alert">
                {unavailableLines.length === 1 ? "1 item in your bag is" : `${unavailableLines.length} items in your bag are`} no longer available, so this order cannot be placed. <Link to="/cart">Remove {unavailableLines.length === 1 ? "it" : "them"} in your bag</Link> to continue.</p>}
            </section>
          </div>

          <div className="checkout-right">
            <div className="checkout-summary">
              <h2>Order summary</h2>
              <div className="checkout-row"><span>{itemCount} units</span><span>{money(subtotal)}</span></div>
              {/* Same transparent breakdown as the bag, from the same server quote, so the customer
                  is confirming the figures they were shown rather than a recalculation. */}
              {offerQuote && (
                <div className="checkout-offer" data-testid="checkout-automatic-offer">
                  <strong>{offerQuote.offerName}</strong>
                  <small>{offerQuote.termsMessage}</small>
                  {offerQuote.completeGroups > 0 && (
                    <small data-testid="checkout-offer-calc">
                      {offerQuote.completeGroups} qualifying {offerQuote.completeGroups === 1 ? "group" : "groups"} × {money(offerQuote.discountPerGroup)}
                    </small>
                  )}
                  {offerQuote.progressMessage && <small>{offerQuote.progressMessage}</small>}
                </div>
              )}
              {(automaticApplied || quote?.appliedPromotion === "COUPON") && (
                <div className="checkout-row checkout-discount" data-testid="checkout-discount-row">
                  <span>{quote.appliedPromotionLabel}</span>
                  <span aria-label={`Discount ${money(discount)}`}>−{money(discount)}</span>
                </div>
              )}
              {quote?.suppressedPromotionReason && (
                <p className="checkout-note" role="status">{quote.suppressedPromotionReason}</p>
              )}
              {/* Included in the subtotal, not added to it — see OrderTotals on the server. */}
              <div className="checkout-row"><span>Includes GST (18%)</span><span>{money(tax)}</span></div>
              <div className="checkout-row"><span>Shipping</span><span>{shipping === 0 ? "Free" : money(shipping)}</span></div>
              <div className="checkout-divider" />
              <div className="checkout-row checkout-total-row"><span>Estimated total</span><span>{money(estimatedTotal)}</span></div>
              <div className="checkout-confirmation-card"><span>Deliver to</span><strong>{selectedAddress?.recipientName || "Select an address"}</strong>{selectedAddress && <p>{selectedAddress.addressLine1}{selectedAddress.addressLine2 && `, ${selectedAddress.addressLine2}`}<br />{selectedAddress.city}, {selectedAddress.state} {selectedAddress.pincode}<br />{selectedAddress.country}{selectedAddress.phoneNumber && ` · ${selectedAddress.phoneNumber}`}</p>}</div>
              <div className="checkout-confirmation-card"><span>Estimated delivery</span><strong>{deliveryStart}–{deliveryEnd}</strong><p>Standard delivery, subject to fulfilment and courier availability.</p></div>
              <p className="checkout-note">The server recalculates current prices, stock, tax and offers. If the final amount differs from {money(estimatedTotal)}, no order or payment will be created.</p>
              {cartSyncing && <p className="checkout-note">Updating your bag before checkout…</p>}
              {(quoteLoading || !priced) && itemCount > 0 && (
                <p className="checkout-note" role="status">Confirming the current price and offer…</p>
              )}
              {error && <p className="checkout-error" role="alert">{error}</p>}
              <label className="checkout-confirm"><input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} /> <span>I reviewed the items, variants, quantities, delivery address and final amount.</span></label>
              <button type="submit" className="checkout-pay-btn" disabled={!canSubmit}>
                {submitting ? "Securing your order…" : pendingOrderId ? "Retry payment confirmation" : `Place order · ${money(estimatedTotal)}`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </main>
  );
};

export default PlaceOrder;
