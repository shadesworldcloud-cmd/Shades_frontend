import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { getAdminReviews, moderateReview } from "../../services/api";
import "./AdminReviews.css";
import "./ReviewModerationPagination.css";
import useConfirmAction from "../../hooks/useConfirmAction";

const label = (value) => String(value || "").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
const variant = (review) => review.variantName || review.variantSku || "Original variant";
const date = (value) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
const Stars = ({ value }) => <span className="moderation-stars" aria-label={`${value} out of 5 stars`}>{[1,2,3,4,5].map((star) => <i key={star} className={star <= value ? "filled" : ""}>★</i>)}</span>;

export default function AdminReviews() {
  const { accessToken } = useAuth();
  const confirmAction = useConfirmAction();
  const [reviews, setReviews] = useState([]);
  const [status, setStatus] = useState("PENDING");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(0);
  const [pageData, setPageData] = useState({ totalElements: 0, totalPages: 0 });

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await getAdminReviews(accessToken, { status, search, page });
      setReviews(result.content || []);
      setPageData({ totalElements: result.totalElements || 0, totalPages: result.totalPages || 0 });
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [accessToken, page, search, status]);
  useEffect(() => { load(); }, [load]);

  const moderate = (review, nextStatus) => {
    const verb = nextStatus === "APPROVED" ? "approve" : "reject";
    return confirmAction.ask({
      title: `${label(verb)} this review?`,
      body: <p>Review #{review.reviewId} from <strong>{review.customerName}</strong> will be {nextStatus === "APPROVED" ? "published to the storefront" : "taken down from the storefront"}.</p>,
      confirmLabel: label(verb),
      busyLabel: "Saving…",
      run: () => applyModeration(review, nextStatus),
    });
  };

  const applyModeration = async (review, nextStatus) => {
    setSavingId(review.reviewId); setError(""); setNotice("");
    try {
      const updated = await moderateReview(accessToken, review.reviewId, nextStatus);
      if (!status || status === updated.reviewStatus) {
        setReviews((current) => current.map((item) => item.reviewId === updated.reviewId ? { ...item, ...updated } : item));
      } else {
        if (reviews.length === 1 && page > 0) {
          setPage((current) => current - 1);
        } else {
          await load();
        }
      }
      setNotice(`Review #${updated.reviewId} was ${updated.reviewStatus.toLowerCase()}.`);
    } catch (err) { setError(err.message); }
    finally { setSavingId(null); }
  };
  const submitSearch = (event) => { event.preventDefault(); setPage(0); setSearch(query); };

  return <section className="review-moderation">
    {confirmAction.dialog}
    {error && <div className="admin-alert error" role="alert">{error}</div>}
    {notice && <div className="admin-alert success" role="status">{notice}</div>}
    <header className="moderation-intro"><div><span>Trust & quality</span><h2>Review moderation</h2><p>Approve useful verified-purchase feedback and keep rejected content off the storefront.</p></div><button onClick={load} disabled={loading}>Refresh</button></header>
    <div className="moderation-stats"><article><span>Current queue</span><strong>{loading ? "—" : pageData.totalElements}</strong><small>{status ? label(status) : "All statuses"}</small></article><article><span>Showing</span><strong>{loading ? "—" : reviews.length}</strong><small>Most recent first</small></article><article><span>Visibility rule</span><strong>Approved</strong><small>Only approved reviews are public</small></article></div>
    <form className="moderation-filters" onSubmit={submitSearch}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product, SKU, customer, email or review"/><button>Search</button><select value={status} onChange={(event) => { setPage(0); setStatus(event.target.value); }}><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="">All statuses</option></select>{search && <button type="button" onClick={() => { setQuery(""); setSearch(""); setPage(0); }}>Clear</button>}</form>
    <div className="moderation-list">{loading ? <div className="moderation-empty">Loading review queue…</div> : reviews.length === 0 ? <div className="moderation-empty"><strong>No reviews found</strong><span>{status === "PENDING" ? "The moderation queue is clear." : "Try another status or search."}</span></div> : reviews.map((review) => <article key={review.reviewId} className="moderation-card"><div className="moderation-card-top"><div className="moderation-product"><span>{review.productName}</span><strong>{variant(review)}</strong><small>{review.variantSku || "No SKU"} · Review #{review.reviewId}</small></div><em className={`moderation-status ${review.reviewStatus.toLowerCase()}`}>{review.reviewStatus}</em></div><Stars value={review.rating}/><blockquote>{review.reviewText || "Rating only - no written review."}</blockquote><footer><div><strong>{review.customerName}</strong><span>{review.customerEmail}</span><small>Submitted {date(review.createdAt)}{review.updatedAt !== review.createdAt ? ` · Edited ${date(review.updatedAt)}` : ""}</small></div><div>{review.reviewStatus !== "REJECTED" && <button className="reject" disabled={savingId === review.reviewId} onClick={() => moderate(review, "REJECTED")}>Reject</button>}{review.reviewStatus !== "APPROVED" && <button className="approve" disabled={savingId === review.reviewId} onClick={() => moderate(review, "APPROVED")}>Approve</button>}</div></footer></article>)}</div>
    {pageData.totalPages > 1 && <nav className="moderation-pagination" aria-label="Review moderation pages"><button disabled={page === 0 || loading} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page + 1} of {pageData.totalPages}</span><button disabled={page + 1 >= pageData.totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next</button></nav>}
  </section>;
}
