import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { cancelOrder, cancelReturn, createReturn, downloadInvoice, getMyOrders, getMyReturns } from "../../services/api";
import { announceCatalogueChanged } from "../../services/catalogueEvents";
import ConfirmDialog from "../../components/ConfirmDialog/ConfirmDialog";
import "./MyOrders.css";
import "../Admin/InvoiceActions.css";

const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const date = (value) => value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "—";
const label = (value) => String(value || "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const blockingReturnStatuses = ["REQUESTED", "APPROVED", "PICKED_UP", "RECEIVED"];
const deliveryStages = ["PACKED", "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"];

export default function MyOrders() {
  const { accessToken, user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [returningOrder, setReturningOrder] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [returnReason, setReturnReason] = useState("");
  const [condition, setCondition] = useState("UNOPENED");
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);
  const [downloadingInvoice, setDownloadingInvoice] = useState(null);
  // The order / return awaiting confirmation, plus the dialog's own busy and error state so a
  // failure is reported inside the dialog rather than behind it.
  const [cancellingOrder, setCancellingOrder] = useState(null);
  const [cancellingReturn, setCancellingReturn] = useState(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [orderPage, returnPage] = await Promise.all([getMyOrders(accessToken), getMyReturns(accessToken)]);
      setOrders(orderPage.content || []); setReturns(returnPage.content || []);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const openReturn = (order) => {
    setReturningOrder(order); setQuantities(Object.fromEntries((order.items || []).map((item) => [item.orderItemId, 0])));
    setReturnReason(""); setCondition("UNOPENED"); setComments(""); setError(""); setNotice("");
  };
  const submitReturn = async (event) => {
    event.preventDefault();
    const items = returningOrder.items.filter((item) => Number(quantities[item.orderItemId]) > 0).map((item) => ({ orderItemId: item.orderItemId, quantity: Number(quantities[item.orderItemId]), itemCondition: condition, returnReason }));
    if (!items.length) return setError("Select at least one item and quantity to return.");
    setSaving(true); setError("");
    try {
      const created = await createReturn(accessToken, { orderId: returningOrder.orderId, returnReason, customerComments: comments, items });
      setReturns((current) => [created, ...current]); setReturningOrder(null); setNotice(`Return request #${created.returnId} was submitted.`);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const confirmCancelReturn = async () => {
    const returnRequest = cancellingReturn;
    setDialogError(""); setDialogBusy(true);
    try {
      const updated = await cancelReturn(accessToken, returnRequest.returnId);
      setReturns((current) => current.map((item) => item.returnId === updated.returnId ? updated : item));
      setCancellingReturn(null);
      setNotice(`Return request #${updated.returnId} was cancelled.`);
    } catch (err) {
      // Keep the dialog open and show the failure in it: closing would leave the shopper
      // unsure whether the request went through.
      setDialogError(err.message);
    } finally { setDialogBusy(false); }
  };
  const getInvoice = async (orderId) => {
    setDownloadingInvoice(orderId); setError("");
    try { await downloadInvoice(accessToken, orderId); }
    catch (err) { setError(err.message); }
    finally { setDownloadingInvoice(null); }
  };
  const orderIsPaid = (order) => Boolean(order?.payments?.some((payment) => ["PAID", "PARTIALLY_REFUNDED"].includes(payment.status)));
  const confirmCancelOrder = async () => {
    const order = cancellingOrder;
    // The dialog does not block the thread the way window.confirm did, so this guard is what
    // now prevents a second submission from a double click or a stray Enter.
    if (dialogBusy) return;
    const paid = orderIsPaid(order);
    setDialogError(""); setDialogBusy(true); setError(""); setNotice("");
    try {
      await cancelOrder(accessToken, order.orderId);
      // Only refresh the order list after the server confirms, so a failed cancel never
      // leaves the UI claiming something that did not happen.
      await load();
      setCancellingOrder(null);
      setNotice(`Order #${order.orderId} was cancelled${paid ? " and its refund was recorded" : ""}.`);
      window.dispatchEvent(new Event("notifications:changed"));
      // Cancelling restores stock server-side, so the storefront's cached catalogue is stale.
      announceCatalogueChanged();
    } catch (err) {
      setDialogError(err.message);
    } finally { setDialogBusy(false); }
  };

  return <main className="my-orders-page"><div className="container">
    <header className="orders-page-header"><div><span>Your account</span><h1>My Orders</h1><p>Welcome back, {user?.name?.split(" ")[0]}. Follow every order from confirmation to delivery.</p></div><Link to="/shop">Continue shopping</Link></header>
    {error && <div className="orders-error">{error}</div>}{notice && <div className="orders-notice">{notice}</div>}
    {loading ? <div className="orders-empty">Loading your orders…</div> : orders.length === 0 ? <div className="orders-empty"><span>SW</span><h2>No orders yet</h2><p>Your Shades World purchases will appear here.</p><Link to="/shop">Explore the collection</Link></div> : <section className="orders-list">{orders.map((order) => {
      const shipment = order.shipments?.[0]; const shipmentStatus = shipment?.status || shipment?.shipmentStatus; const shipmentStage = deliveryStages.indexOf(shipmentStatus); const open = expanded === order.orderId;
      const orderReturns = returns.filter((item) => item.orderId === order.orderId);
      const latestReturn = orderReturns[0];
      const active = orderReturns.find((item) => blockingReturnStatuses.includes(item.returnStatus));
      const refundTotal = orderReturns.flatMap((item) => item.refunds || []).reduce((sum, refund) => sum + Number(refund.amount), 0);
      const returnDeadline = order.deliveredAt ? new Date(order.deliveredAt).getTime() + 30 * 24 * 60 * 60 * 1000 : 0;
      const withinReturnWindow = returnDeadline >= Date.now();
      return <article className="customer-order" key={order.orderId}>
        <header><div><small>Order</small><strong>#{order.orderId}</strong></div><div><small>Placed</small><strong>{date(order.purchasedAt)}</strong></div><div><small>Total</small><strong>{money(order.totalAmount)}</strong></div><span className={`order-state ${order.orderStatus?.toLowerCase()}`}>{label(order.orderStatus)}</span></header>
        <div className={`order-progress ${shipmentStatus === "FAILED" ? "delivery-failed" : ""}`}><span className="done">Ordered</span><i/><span className={shipment ? "done" : ["PROCESSING","SHIPPED","DELIVERED"].includes(order.orderStatus) ? "done" : ""}>Preparing</span><i/><span className={shipmentStage >= 1 || ["SHIPPED","DELIVERED"].includes(order.orderStatus) ? "done" : ""}>Shipped</span><i/><span className={shipmentStage >= 2 ? "done" : ""}>In transit</span><i/><span className={shipmentStage >= 3 ? "done" : ""}>Out for delivery</span><i/><span className={shipmentStage >= 4 || order.orderStatus === "DELIVERED" ? "done" : ""}>Delivered</span></div>
        {shipment && <div className={`delivery-summary ${shipmentStatus === "FAILED" ? "failed" : ""}`}><div><span>{shipmentStatus === "FAILED" ? "Delivery issue" : label(shipmentStatus)}</span><strong>{shipment.provider || shipment.shippingProvider} · {shipment.trackingNumber}</strong></div><div><small>{shipment.expectedDeliveryAt && shipmentStatus !== "DELIVERED" ? "Expected delivery" : shipmentStatus === "DELIVERED" ? "Delivered" : "Last update"}</small><strong>{date(shipmentStatus === "DELIVERED" ? shipment.deliveredAt : shipment.expectedDeliveryAt || shipment.shippedAt)}</strong></div></div>}
        <div className="order-items">{order.items?.map((item) => <div className="customer-order-item" key={item.orderItemId}><span className="order-item-mark">{item.productName?.charAt(0)}</span><div><strong>{item.productName}</strong><small>{item.variantLabel ? `${item.variantLabel} · ` : ""}{item.sku} · Quantity {item.quantity}</small></div><b>{money(item.lineTotal)}</b></div>)}</div>
        {latestReturn && <div className="customer-return-summary"><span>Return #{latestReturn.returnId}</span><strong>{label(latestReturn.returnStatus)}</strong><p>{latestReturn.adminComments || (active ? "We will show updates here as your return is reviewed." : "This return request is closed.")}</p>{refundTotal > 0 && <b>Refunded: {money(refundTotal)}</b>}{latestReturn.returnStatus === "REQUESTED" && <button onClick={() => { setDialogError(""); setCancellingReturn(latestReturn); }}>Cancel request</button>}</div>}
        <div className="order-buttons"><button className="order-details-toggle" onClick={() => setExpanded(open ? null : order.orderId)}>{open ? "Hide details" : "View order details"}</button>{order.payments?.some((payment) => ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)) && <button className="invoice-download-button" disabled={downloadingInvoice === order.orderId} onClick={() => getInvoice(order.orderId)}>{downloadingInvoice === order.orderId ? "Preparing invoice…" : "Download invoice"}</button>}{["PLACED", "CONFIRMED"].includes(order.orderStatus) && <button className="cancel-order-button" disabled={dialogBusy && cancellingOrder?.orderId === order.orderId} onClick={() => { setDialogError(""); setCancellingOrder(order); }}>Cancel order</button>}{order.orderStatus === "DELIVERED" && withinReturnWindow && !active && <button className="request-return-button" onClick={() => openReturn(order)}>Request a return</button>}{order.orderStatus === "DELIVERED" && !withinReturnWindow && <small className="return-window-closed">Return window closed</small>}</div>
        {open && <div className="order-extra"><section><h3>Delivery address</h3><p>{order.shippingAddress.name}<br/>{order.shippingAddress.line1}{order.shippingAddress.line2 && `, ${order.shippingAddress.line2}`}<br/>{order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.pincode}<br/>{order.shippingAddress.country}</p></section><section><h3>Payment & delivery</h3><p>Payment: {order.payments?.[0] ? label(order.payments[0].status) : "Not recorded"}<br/>Courier: {shipment?.provider || shipment?.shippingProvider || "Assigned before dispatch"}<br/>Tracking: {shipment?.trackingNumber || "Available after dispatch"}<br/>Status: {shipmentStatus ? label(shipmentStatus) : "Preparing"}<br/>{shipment?.expectedDeliveryAt ? `Expected by ${date(shipment.expectedDeliveryAt)}` : order.deliveredAt ? `Delivered ${date(order.deliveredAt)}` : "Delivery estimate pending"}</p></section><section><h3>Price summary</h3><p>Subtotal: {money(order.subtotalAmount)}<br/>Discount: −{money(order.discountAmount)}<br/>Shipping: {money(order.shippingAmount)}<br/>Includes GST: {money(order.taxAmount)}</p><strong>Total: {money(order.totalAmount)}</strong></section></div>}
      </article>;
    })}</section>}
  </div>
  <ConfirmDialog open={Boolean(cancellingOrder)} title={`Cancel order #${cancellingOrder?.orderId}?`}
    confirmLabel="Cancel the order" cancelLabel="Keep order" busyLabel="Cancelling…"
    busy={dialogBusy} error={dialogError}
    onCancel={() => { setCancellingReturn(null); setCancellingOrder(null); setDialogError(""); }}
    onConfirm={confirmCancelOrder}>
    <p>This <strong>cannot be undone</strong>. Order #{cancellingOrder?.orderId} for {money(cancellingOrder?.totalAmount)} will be cancelled and its items returned to stock.</p>
    {orderIsPaid(cancellingOrder) && <p>The paid balance will be recorded for refund.</p>}
  </ConfirmDialog>
  <ConfirmDialog open={Boolean(cancellingReturn)} title={`Cancel return request #${cancellingReturn?.returnId}?`}
    confirmLabel="Cancel the request" cancelLabel="Keep request" busyLabel="Cancelling…"
    busy={dialogBusy} error={dialogError}
    onCancel={() => { setCancellingReturn(null); setDialogError(""); }}
    onConfirm={confirmCancelReturn}>
    <p>Your return request will be withdrawn and the items stay with you. You can request a return again while the 30-day window is open.</p>
  </ConfirmDialog>
  {returningOrder && <div className="return-modal-backdrop" onMouseDown={() => !saving && setReturningOrder(null)}><form className="return-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submitReturn}><header><div><span>Order #{returningOrder.orderId}</span><h2>Request a return</h2></div><button type="button" onClick={() => setReturningOrder(null)}>×</button></header><p>Select the quantity of each item you want to send back.</p><div className="return-modal-items">{returningOrder.items.map((item) => <label key={item.orderItemId}><span><strong>{item.productName}</strong><small>{item.variantLabel ? `${item.variantLabel} · ` : ""}{item.sku} · Purchased {item.quantity}</small></span><input aria-label={`Return quantity for ${item.productName}`} type="number" min="0" max={item.quantity} value={quantities[item.orderItemId] || 0} onChange={(event) => setQuantities((current) => ({ ...current, [item.orderItemId]: event.target.value }))}/></label>)}</div><label>Reason for return *<select required value={returnReason} onChange={(event) => setReturnReason(event.target.value)}><option value="">Choose a reason</option><option value="Damaged or defective">Damaged or defective</option><option value="Wrong item received">Wrong item received</option><option value="Not as described">Not as described</option><option value="Changed my mind">Changed my mind</option><option value="Other">Other</option></select></label><label>Item condition<select value={condition} onChange={(event) => setCondition(event.target.value)}><option value="UNOPENED">Unopened</option><option value="OPENED_UNUSED">Opened, unused</option><option value="USED">Used</option><option value="DAMAGED">Damaged</option></select></label><label>Comments<textarea value={comments} onChange={(event) => setComments(event.target.value)} maxLength="1000" placeholder="Tell us anything that will help us review the request."/></label><footer><button type="button" onClick={() => setReturningOrder(null)}>Cancel</button><button disabled={saving}>{saving ? "Submitting…" : "Submit return"}</button></footer></form></div>}</main>;
}
