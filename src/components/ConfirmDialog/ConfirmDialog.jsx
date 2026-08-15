import { useEffect, useRef } from "react";
import "./ConfirmDialog.css";

/**
 * Confirmation dialog for destructive actions, replacing window.confirm.
 *
 * window.confirm blocked the JS thread, which meant double-submission was impossible by
 * construction. A React modal does not, so `busy` both disables the confirm control and stops
 * Escape/backdrop dismissal while a request is in flight — otherwise a shopper could dismiss the
 * dialog mid-cancel and be left with no idea whether it happened.
 *
 * Focus is moved to the least destructive control on open and restored to the invoking element on
 * close, and Tab is trapped inside the dialog so keyboard users cannot wander into the page behind.
 */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Close",
  busyLabel,
  busy = false,
  error = "",
  onConfirm,
  onCancel,
}) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const restoreFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    // Only ever capture something OUTSIDE the dialog. React 18's StrictMode runs this effect
    // mount → cleanup → mount in development, so a bare capture ran a second time after the line
    // below had already moved focus to the cancel button — storing that button as the thing to
    // restore. It is unmounted by the time the dialog closes, so document.contains() rejects it
    // and focus silently fell to <body> instead of returning to whatever opened the dialog.
    const active = document.activeElement;
    if (!dialogRef.current || !dialogRef.current.contains(active)) restoreFocusRef.current = active;
    // Focus the non-destructive action: opening a dialog should never leave the destructive
    // button one stray Enter away.
    cancelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      const restore = restoreFocusRef.current;
      if (!restore || typeof restore.focus !== "function") return;
      // Deferred by a task. Closing via a button INSIDE the dialog means the focused element is
      // about to be removed from the document, and the browser resets focus to <body> as part of
      // that removal — which happened after a synchronous restore here and silently undid it.
      // Escape and backdrop clicks did not hit this, because focus was not being destroyed by the
      // same commit, which is why only the Close button appeared to lose focus restoration.
      setTimeout(() => {
        if (document.contains(restore)) restore.focus();
      }, 0);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        if (busy) return;
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="confirm-backdrop" onMouseDown={() => { if (!busy) onCancel(); }}>
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-body" ref={dialogRef} onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="confirm-dialog-title">{title}</h2>
        <div id="confirm-dialog-body" className="confirm-dialog-body">{children}</div>
        {error && <p className="confirm-dialog-error" role="alert">{error}</p>}
        <footer>
          <button type="button" ref={cancelRef} className="confirm-dialog-cancel" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          {/* Omitted when no onConfirm is supplied, so this same dialog can host a purely
              informational panel — the Contact Customer Care sheet has two external links and a
              Close, and no "confirm" to make. Every destructive call site passes onConfirm and is
              unaffected. */}
          {onConfirm && (
            <button type="button" className="confirm-dialog-confirm" disabled={busy} onClick={onConfirm}>
              {busy ? busyLabel || "Working…" : confirmLabel}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
