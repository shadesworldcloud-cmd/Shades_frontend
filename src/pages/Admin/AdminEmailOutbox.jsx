import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { getEmailOutbox, getEmailOutboxSummary, retryEmailOutbox } from "../../services/api";
import "./AdminEmailOutbox.css";

const filters = ["", "PENDING", "RETRY", "SENT", "FAILED"];
const labels = { "": "All", PENDING: "Pending", RETRY: "Retrying", SENT: "Sent", FAILED: "Failed" };
const formatDate = (value) => value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

export default function AdminEmailOutbox() {
  const { accessToken } = useAuth();
  const [messages, setMessages] = useState([]);
  const [summary, setSummary] = useState({ total: 0, pending: 0, retry: 0, sent: 0, failed: 0 });
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [pageData, setPageData] = useState({ totalPages: 0, totalElements: 0 });
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [result, counts] = await Promise.all([
        getEmailOutbox(accessToken, { status, search: query, page }),
        getEmailOutboxSummary(accessToken),
      ]);
      setMessages(result.content || []);
      setPageData({ totalPages: result.totalPages || 0, totalElements: result.totalElements || 0 });
      setSummary(counts);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, query, status]);

  useEffect(() => { load(); }, [load]);

  const applySearch = (event) => {
    event.preventDefault();
    setPage(0);
    setQuery(search);
  };

  const retry = async (message) => {
    setRetrying(message.emailOutboxId);
    setError("");
    setNotice("");
    try {
      await retryEmailOutbox(accessToken, message.emailOutboxId);
      setNotice(`Email #${message.emailOutboxId} was queued for immediate retry.`);
      await load();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setRetrying(null);
    }
  };

  return <section className="outbox-admin">
    {error && <div className="admin-alert error" role="alert">{error}</div>}
    {notice && <div className="admin-alert success" role="status">{notice}</div>}
    <div className="outbox-title"><div><h2>Email delivery</h2><p>Monitor transactional messages from refunds, returns, password recovery and other store flows.</p></div><button onClick={load} disabled={loading}>Refresh</button></div>
    <div className="outbox-stats">
      <article><span>Total</span><strong>{summary.total}</strong></article>
      <article><span>Waiting</span><strong>{summary.pending}</strong></article>
      <article><span>Retrying</span><strong>{summary.retry}</strong></article>
      <article><span>Delivered</span><strong>{summary.sent}</strong></article>
      <article className={summary.failed ? "has-failures" : ""}><span>Failed</span><strong>{summary.failed}</strong></article>
    </div>
    <div className="outbox-controls">
      <div className="outbox-tabs">{filters.map((value) => <button key={value || "ALL"} className={status === value ? "active" : ""} onClick={() => { setStatus(value); setPage(0); }}>{labels[value]}</button>)}</div>
      <form onSubmit={applySearch}><input aria-label="Search email outbox" placeholder="Search recipient or subject" value={search} onChange={(event) => setSearch(event.target.value)} /><button>Search</button></form>
    </div>
    <div className="outbox-table-wrap"><table className="outbox-table"><thead><tr><th>Recipient & subject</th><th>Status</th><th>Attempts</th><th>Created</th><th>Delivery timing</th><th>Result</th><th></th></tr></thead><tbody>
      {loading ? <tr><td colSpan="7" className="outbox-empty">Loading email activity…</td></tr> : messages.length === 0 ? <tr><td colSpan="7" className="outbox-empty">No email messages match this view.</td></tr> : messages.map((message) => <tr key={message.emailOutboxId}>
        <td><strong>{message.recipient}</strong><span>#{message.emailOutboxId} · {message.subject}</span></td>
        <td><em className={`outbox-status ${message.status.toLowerCase()}`}>{labels[message.status]}</em></td>
        <td>{message.attemptCount}</td><td>{formatDate(message.createdAt)}</td>
        <td><span>{message.sentAt ? "Sent" : message.status === "RETRY" ? "Next attempt" : "Scheduled"}</span><strong>{formatDate(message.sentAt || message.nextAttemptAt)}</strong></td>
        <td className="outbox-result">{message.lastError || (message.status === "SENT" ? "Delivered successfully" : "Awaiting delivery")}</td>
        <td>{message.canRetry ? <button className="outbox-retry" onClick={() => retry(message)} disabled={retrying === message.emailOutboxId}>{retrying === message.emailOutboxId ? "Queuing…" : "Retry"}</button> : message.status === "FAILED" ? <small className="outbox-locked">Not retryable</small> : null}</td>
      </tr>)}</tbody></table></div>
    <div className="outbox-pagination"><span>{pageData.totalElements} message{pageData.totalElements === 1 ? "" : "s"}</span><div><button disabled={page === 0 || loading} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {pageData.totalPages ? page + 1 : 0} of {pageData.totalPages}</span><button disabled={page + 1 >= pageData.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    <p className="outbox-security-note">For security, email contents and password-reset links are never exposed here. Expired or securely removed messages cannot be retried.</p>
  </section>;
}
