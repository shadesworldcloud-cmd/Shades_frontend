import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { createShipment, createShiprocketShipment, assignShiprocketAwb, scheduleShiprocketPickup, generateShiprocketLabel, downloadInvoice, getAdminOrders, updateAdminOrderStatus, updateShipmentStatus } from "../../services/api";
import "./AdminOrders.css";
import "./ShipmentTracking.css";
import "./InvoiceActions.css";

const nextStatus = { PLACED: "CONFIRMED", CONFIRMED: "PROCESSING", PROCESSING: "SHIPPED", SHIPPED: "DELIVERED" };
const actionLabel = { CONFIRMED: "Confirm order", PROCESSING: "Start processing", SHIPPED: "Mark shipped", DELIVERED: "Mark delivered" };
const shipmentActions = {
  PENDING: [{ status: "PACKED", label: "Mark packed" }, { status: "FAILED", label: "Report issue" }],
  PACKED: [{ status: "SHIPPED", label: "Dispatch" }, { status: "FAILED", label: "Report issue" }],
  SHIPPED: [{ status: "IN_TRANSIT", label: "Mark in transit" }, { status: "FAILED", label: "Report issue" }],
  IN_TRANSIT: [{ status: "OUT_FOR_DELIVERY", label: "Out for delivery" }, { status: "FAILED", label: "Report issue" }],
  OUT_FOR_DELIVERY: [{ status: "DELIVERED", label: "Mark delivered" }, { status: "FAILED", label: "Report issue" }],
  FAILED: [{ status: "IN_TRANSIT", label: "Resume transit" }],
  DELIVERED: [{ status: "RETURNED", label: "Mark returned" }],
};
const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const date = (value) => value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const label = (value) => String(value || "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function AdminOrders() {
  const { accessToken } = useAuth();
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [notes, setNotes] = useState("");
  const [shipment, setShipment] = useState({ shippingProvider: "", trackingNumber: "", expectedDeliveryAt: "" });
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const page = await getAdminOrders(accessToken); setOrders(page.content || []); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [accessToken]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => orders.filter((order) => {
    const term = query.trim().toLowerCase();
    const searchMatch = !term || String(order.orderId).includes(term) || order.customer?.name?.toLowerCase().includes(term) || order.customer?.email?.toLowerCase().includes(term);
    return searchMatch && (status === "all" || order.orderStatus === status);
  }), [orders, query, status]);
  const units = (order) => order.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
  const sync = (updated) => { setOrders((current) => current.map((item) => item.orderId === updated.orderId ? updated : item)); setSelected(updated); };

  const progress = async () => {
    const next = nextStatus[selected.orderStatus]; if (!next) return;
    setSaving(true); setError("");
    try { const updated = await updateAdminOrderStatus(accessToken, selected.orderId, next, notes || `Order moved to ${next}`); sync(updated); setNotes(""); setNotice(`Order #${updated.orderId} is now ${next.toLowerCase()}.`); }
    catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const addShipment = async (event) => {
    event.preventDefault(); setSaving(true); setError("");
    try { const created = await createShipment(accessToken, selected.orderId, { ...shipment, expectedDeliveryAt: shipment.expectedDeliveryAt || null }); const apply = (order) => ({ ...order, orderStatus: order.orderStatus === "CONFIRMED" ? "PROCESSING" : order.orderStatus, shipments: [{ ...created, provider: created.shippingProvider, status: created.shipmentStatus }, ...(order.shipments || [])] }); setSelected((current) => apply(current)); setOrders((current) => current.map((order) => order.orderId === selected.orderId ? apply(order) : order)); setShipment({ shippingProvider: "", trackingNumber: "", expectedDeliveryAt: "" }); setNotice("Shipment and tracking details added."); }
    catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const shipmentProgress = async (item, next) => {
    setSaving(true); setError("");
    try { const updated = await updateShipmentStatus(accessToken, item.shipmentId, next); const apply = (order) => ({ ...order, orderStatus: next === "SHIPPED" ? "SHIPPED" : next === "DELIVERED" ? "DELIVERED" : order.orderStatus, shipments: (order.shipments || []).map((entry) => entry.shipmentId === updated.shipmentId ? { ...updated, provider: updated.shippingProvider, status: updated.shipmentStatus } : entry) }); setSelected((current) => apply(current)); setOrders((current) => current.map((order) => order.orderId === selected.orderId ? apply(order) : order)); setNotice(`Shipment marked ${next.toLowerCase().replaceAll("_", " ")}.`); }
    catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const getInvoice = async () => {
    setDownloadingInvoice(true); setError("");
    try { await downloadInvoice(accessToken, selected.orderId, true); }
    catch (err) { setError(err.message); }
    finally { setDownloadingInvoice(false); }
  };

  // ---- Shiprocket actions ----
  const shiprocketShip = async () => {
    setSaving(true); setError("");
    try {
      const created = await createShiprocketShipment(accessToken, selected.orderId);
      const apply = (order) => ({
        ...order,
        orderStatus: order.orderStatus === "CONFIRMED" ? "PROCESSING" : order.orderStatus,
        shipments: [{ ...created, provider: created.shippingProvider || "Shiprocket", status: created.shipmentStatus }, ...(order.shipments || [])]
      });
      setSelected((c) => apply(c)); setOrders((c) => c.map((o) => o.orderId === selected.orderId ? apply(o) : o));
      setNotice("Order pushed to Shiprocket. Now assign AWB →");
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const shiprocketAwb = async (s) => {
    setSaving(true); setError("");
    try {
      const awbResult = await assignShiprocketAwb(accessToken, s.shipmentId);
      if (awbResult.awb_assign_status === 1 || awbResult.awbAssignStatus === 1) {
        setNotice("AWB assigned! Next: schedule pickup →");
      } else {
        setNotice("AWB assignment queued — refresh to see courier details.");
      }
      await load(); // refresh orders to pick up new AWB/courier data
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const shiprocketPickup = async (s) => {
    setSaving(true); setError("");
    try {
      await scheduleShiprocketPickup(accessToken, s.shipmentId);
      setNotice("Pickup scheduled with courier. Generate label →");
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const shiprocketLabel = async (s) => {
    setSaving(true); setError("");
    try {
      const result = await generateShiprocketLabel(accessToken, s.shipmentId);
      const labelUrl = result?.label_url || result?.labelUrl;
      if (labelUrl) window.open(labelUrl, "_blank");
      setNotice("Label generated.");
      await load();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  return <section className="orders-admin">
    {error && <div className="admin-alert error">{error}</div>}{notice && <div className="admin-alert success">{notice}</div>}
    <div className="orders-intro"><div><h2>Orders & fulfillment</h2><p>Review purchases, payments and delivery progress.</p></div><button onClick={load}>Refresh</button></div>
    <div className="order-stats"><article><span>Total orders</span><strong>{filtered.length}</strong></article><article><span>Needs action</span><strong>{filtered.filter((o) => ["PLACED", "CONFIRMED"].includes(o.orderStatus)).length}</strong></article><article><span>In transit</span><strong>{filtered.filter((o) => ["PROCESSING", "SHIPPED"].includes(o.orderStatus)).length}</strong></article><article><span>Revenue</span><strong>{money(filtered.filter((o) => o.orderStatus !== "CANCELLED").reduce((sum, o) => sum + Number(o.totalAmount), 0))}</strong></article></div>
    <div className="order-filters"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search order, customer or email" /><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option>{["PLACED", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED"].map((item) => <option key={item}>{item}</option>)}</select></div>
    <div className="orders-table"><div className="orders-table-head"><span>Order</span><span>Customer</span><span>Date</span><span>Items</span><span>Total</span><span>Status</span><span></span></div>
      {loading ? <div className="orders-message">Loading orders…</div> : filtered.length === 0 ? <div className="orders-message"><strong>No orders found</strong><span>New customer orders will appear here.</span></div> : filtered.map((order) => <button className="order-row" key={order.orderId} onClick={() => { setSelected(order); setNotice(""); }}><strong>#{order.orderId}</strong><span><b>{order.customer?.name}</b><small>{order.customer?.email}</small></span><span>{date(order.purchasedAt)}</span><span>{units(order)}</span><strong>{money(order.totalAmount)}</strong><em className={`order-badge ${order.orderStatus.toLowerCase()}`}>{order.orderStatus}</em><span>View →</span></button>)}
    </div>

    {selected && <div className="order-drawer-backdrop" onMouseDown={() => setSelected(null)}><aside className="order-drawer" onMouseDown={(e) => e.stopPropagation()}><header><div><span>Order #{selected.orderId}</span><h2>{selected.customer?.name}</h2><p>{date(selected.purchasedAt)}</p></div><button onClick={() => setSelected(null)}>×</button></header>
      <div className="drawer-status"><em className={`order-badge ${selected.orderStatus.toLowerCase()}`}>{selected.orderStatus}</em><strong>{money(selected.totalAmount)}</strong>{selected.payments?.some((payment) => ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)) && <button className="admin-invoice-button" disabled={downloadingInvoice} onClick={getInvoice}>{downloadingInvoice ? "Preparing…" : "Download invoice"}</button>}</div>
      <section><h3>Items</h3>{selected.items?.map((item) => <div className="drawer-item" key={item.orderItemId}><div><strong>{item.productName}</strong><small>{item.variantLabel ? `${item.variantLabel} · ` : ""}{item.sku} · {item.quantity} × {money(item.unitPrice)}</small></div><b>{money(item.lineTotal)}</b></div>)}</section>
      <section><h3>Shipping address</h3><p>{selected.shippingAddress?.name} · {selected.shippingAddress?.phone}<br />{selected.shippingAddress?.line1}{selected.shippingAddress?.line2 && `, ${selected.shippingAddress.line2}`}<br />{selected.shippingAddress?.city}, {selected.shippingAddress?.state} {selected.shippingAddress?.pincode}<br />{selected.shippingAddress?.country}</p></section>
      <section><h3>Payment</h3>{selected.payments?.length ? selected.payments.map((p) => <div className="detail-line" key={p.paymentId}><span>{p.method} · {p.provider || "Store"}</span><b>{p.status}</b></div>) : <p>No payment record yet.</p>}</section>
      <section><h3>Shipment & delivery</h3>{selected.shipments?.map((s) => { const shipmentStatus = s.status || s.shipmentStatus; const isSR = !!(s.shiprocketOrderId || s.shiprocketShipmentId); return <div className="shipment-card" key={s.shipmentId}><div><strong>{s.provider || s.shippingProvider || "Courier pending"}{isSR && <span className="sr-badge">Shiprocket</span>}</strong><small>{s.awbCode ? `AWB: ${s.awbCode}` : s.trackingNumber || "No tracking number"} · {label(shipmentStatus)}</small>{s.courierName && <small>Courier: {s.courierName}</small>}{s.expectedDeliveryAt && <small>Expected {date(s.expectedDeliveryAt)}</small>}{s.labelUrl && <small><a href={s.labelUrl} target="_blank" rel="noopener noreferrer">View label ↗</a></small>}</div><div className="shipment-actions">{isSR && !s.awbCode && <button disabled={saving} onClick={() => shiprocketAwb(s)}>Assign AWB</button>}{isSR && s.awbCode && shipmentStatus === "PACKED" && <button disabled={saving} onClick={() => shiprocketPickup(s)}>Schedule Pickup</button>}{isSR && s.awbCode && !s.labelUrl && <button disabled={saving} onClick={() => shiprocketLabel(s)}>Generate Label</button>}{(shipmentActions[shipmentStatus] || []).map((action) => <button className={action.status === "FAILED" ? "shipment-issue" : ""} key={action.status} disabled={saving} onClick={() => shipmentProgress(s, action.status)}>{action.label}</button>)}</div></div>})}{selected.shipments?.length === 0 && ["CONFIRMED", "PROCESSING"].includes(selected.orderStatus) && <div className="shipment-options"><button className="shiprocket-ship-btn" disabled={saving} onClick={shiprocketShip}>{saving ? "Pushing to Shiprocket…" : "🚀 Ship via Shiprocket"}</button><details className="manual-shipment-toggle"><summary>Or add manually</summary><form className="shipment-form" onSubmit={addShipment}><input placeholder="Courier" maxLength="100" value={shipment.shippingProvider} onChange={(e) => setShipment({ ...shipment, shippingProvider: e.target.value })} required /><input placeholder="Tracking number" maxLength="255" value={shipment.trackingNumber} onChange={(e) => setShipment({ ...shipment, trackingNumber: e.target.value })} required /><label>Expected delivery<input type="datetime-local" min={new Date(Date.now() + 60000).toISOString().slice(0,16)} value={shipment.expectedDeliveryAt} onChange={(e) => setShipment({ ...shipment, expectedDeliveryAt: e.target.value })} /></label><button disabled={saving}>Add shipment</button></form></details></div>}</section>
      <section><h3>Status history</h3><div className="order-timeline">{selected.history?.map((h, index) => <div key={`${h.changedAt}-${index}`}><i></i><span><b>{h.newStatus}</b><small>{h.notes || "Status updated"} · {date(h.changedAt)}</small></span></div>)}</div></section>
      {nextStatus[selected.orderStatus] && <footer><textarea rows="2" placeholder="Internal status note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} /><button disabled={saving} onClick={progress}>{saving ? "Saving…" : actionLabel[nextStatus[selected.orderStatus]]}</button></footer>}
    </aside></div>}
  </section>;
}
