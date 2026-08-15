import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { getAdminCustomers, setCustomerActive } from "../../services/api";
import "./AdminOperations.css";
import useConfirmAction from "../../hooks/useConfirmAction";
const money = (v) =>
  `₹${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const date = (v) =>
  v
    ? new Date(v).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Never";
export default function AdminCustomers() {
  const { accessToken, user } = useAuth();
  const confirmAction = useConfirmAction();
  const [customers, setCustomers] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await getAdminCustomers(accessToken);
      setCustomers(
        (page.content || []).filter((item) => item.userId !== user?.userId),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, user?.userId]);
  useEffect(() => {
    load();
  }, [load]);
  const filtered = useMemo(
    () =>
      customers.filter((c) => {
        const term = query.toLowerCase();
        return (
          (!term ||
            c.name.toLowerCase().includes(term) ||
            c.email.toLowerCase().includes(term) ||
            c.phoneNumber?.includes(term)) &&
          (filter === "all" || (filter === "active" ? c.isActive : !c.isActive))
        );
      }),
    [customers, query, filter],
  );
  const toggle = (customer) => {
    const active = !customer.isActive;
    return confirmAction.ask({
      title: `${active ? "Reactivate" : "Deactivate"} this customer?`,
      body: <p><strong>{customer.name}</strong> will {active ? "be able to sign in and place orders again" : "no longer be able to sign in. Existing orders are unaffected"}.</p>,
      confirmLabel: active ? "Reactivate" : "Deactivate",
      busyLabel: "Saving…",
      run: async () => {
      const updated = await setCustomerActive(
        accessToken,
        customer.userId,
        active,
      );
      setCustomers((current) =>
        current.map((c) => (c.userId === updated.userId ? updated : c)),
      );
      setSelected(updated);
      setNotice(`${updated.name} is now ${active ? "active" : "inactive"}.`);
      },
    });
  };
  return (
    <section className="ops-admin">
      {confirmAction.dialog}
      {error && <div className="admin-alert error">{error}</div>}
      {notice && <div className="admin-alert success">{notice}</div>}
      <div className="ops-title">
        <div>
          <h2>Customer directory</h2>
          <p>Understand customer value, activity and account health.</p>
        </div>
        <button onClick={load}>Refresh</button>
      </div>
      <div className="ops-stats">
        <article>
          <span>Displayed customers</span>
          <strong>{filtered.length}</strong>
        </article>
        <article>
          <span>Active</span>
          <strong>{filtered.filter((c) => c.isActive).length}</strong>
        </article>
        <article>
          <span>Total orders</span>
          <strong>{filtered.reduce((s, c) => s + c.orderCount, 0)}</strong>
        </article>
        <article>
          <span>Customer value</span>
          <strong>
            {money(filtered.reduce((s, c) => s + Number(c.totalSpent), 0))}
          </strong>
        </article>
      </div>
      <div className="ops-filters">
        <input
          placeholder="Search name, email or phone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All accounts</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <div className="ops-list">
        {loading ? (
          <div className="ops-empty">Loading customers…</div>
        ) : filtered.length === 0 ? (
          <div className="ops-empty">No customers found.</div>
        ) : (
          filtered.map((c) => (
            <button
              className="customer-row"
              key={c.userId}
              onClick={() => setSelected(c)}
            >
              <span className="customer-avatar">
                {c.name.charAt(0).toUpperCase()}
              </span>
              <span>
                <b>{c.name}</b>
                <small>{c.email}</small>
              </span>
              <span>
                <small>Joined</small>
                <b>{date(c.createdAt)}</b>
              </span>
              <span>
                <small>Orders</small>
                <b>{c.orderCount}</b>
              </span>
              <strong>{money(c.totalSpent)}</strong>
              <em
                className={c.isActive ? "account-active" : "account-inactive"}
              >
                {c.isActive ? "Active" : "Inactive"}
              </em>
              <span>View →</span>
            </button>
          ))
        )}
      </div>
      {selected && (
        <div className="ops-backdrop" onMouseDown={() => setSelected(null)}>
          <aside
            className="ops-drawer"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <span>Customer #{selected.userId}</span>
                <h2>{selected.name}</h2>
                <p>
                  {selected.email} · {selected.phoneNumber || "No phone"}
                </p>
              </div>
              <button onClick={() => setSelected(null)}>×</button>
            </header>
            <div className="customer-metrics">
              <div>
                <span>Orders</span>
                <strong>{selected.orderCount}</strong>
              </div>
              <div>
                <span>Total spent</span>
                <strong>{money(selected.totalSpent)}</strong>
              </div>
              <div>
                <span>Last order</span>
                <strong>{date(selected.lastOrderAt)}</strong>
              </div>
              <div>
                <span>Last login</span>
                <strong>{date(selected.lastLoginAt)}</strong>
              </div>
            </div>
            <section>
              <h3>Account</h3>
              <div className="detail-line">
                <span>Email verified</span>
                <b>{selected.emailVerified ? "Yes" : "No"}</b>
              </div>
              <div className="detail-line">
                <span>Account status</span>
                <b>{selected.isActive ? "Active" : "Inactive"}</b>
              </div>
              <button
                className={selected.isActive ? "danger-button" : "safe-button"}
                onClick={() => toggle(selected)}
              >
                {selected.isActive
                  ? "Deactivate customer"
                  : "Reactivate customer"}
              </button>
            </section>
            <section>
              <h3>Saved addresses</h3>
              {selected.addresses?.length ? (
                selected.addresses.map((a) => (
                  <div className="address-card" key={a.addressId}>
                    <b>
                      {a.recipientName} {a.isDefault && <em>Default</em>}
                    </b>
                    <p>
                      {a.line1}
                      {a.line2 && `, ${a.line2}`}
                      <br />
                      {a.city}, {a.state} {a.pincode}
                      <br />
                      {a.country}
                    </p>
                  </div>
                ))
              ) : (
                <p>No saved addresses.</p>
              )}
            </section>
          </aside>
        </div>
      )}
    </section>
  );
}
