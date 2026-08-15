import { useState } from "react";
import ConfirmDialog from "../components/ConfirmDialog/ConfirmDialog";

/**
 * Turns a `window.confirm` guard into the application's ConfirmDialog.
 *
 * There were seven `if (!window.confirm(...)) return;` guards across the account and admin screens.
 * Each one needed the same four things once it became a real modal — a pending-action slot, a busy
 * flag so a second click cannot fire the request twice, an in-modal error so a failure does not
 * silently close the dialog, and "close only after the action succeeds". Writing that seven times
 * is seven chances to get one of them wrong, which is how the original copies drifted.
 *
 * window.confirm blocked the JS thread, so double submission was impossible by construction and no
 * call site needed a guard. A React modal does not block, so the guard has to be deliberate — the
 * same reasoning already documented on ConfirmDialog itself.
 *
 * Usage:
 *   const { ask, dialog } = useConfirmAction();
 *   ...
 *   <button onClick={() => ask({ title: "Remove address?", body: "…", confirmLabel: "Remove",
 *                                run: () => deleteAddress(...) })}>Remove</button>
 *   ...
 *   {dialog}
 *
 * `run` may be async. If it throws, the dialog stays open and shows the message; the caller's own
 * state is left untouched, so nothing in the page claims an action that did not happen.
 */
export default function useConfirmAction() {
  const [request, setRequest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ask = (next) => { setError(""); setRequest(next); };

  // Refuses to close mid-flight, so a customer cannot dismiss the dialog while the request is in
  // the air and be left unsure whether it landed.
  const close = () => { if (busy) return; setRequest(null); setError(""); };

  const confirm = async () => {
    if (busy || !request) return;
    setBusy(true);
    setError("");
    try {
      await request.run();
      setRequest(null);
    } catch (failure) {
      setError(failure?.message || "That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const dialog = (
    <ConfirmDialog
      open={Boolean(request)}
      title={request?.title || ""}
      confirmLabel={request?.confirmLabel || "Confirm"}
      busyLabel={request?.busyLabel}
      cancelLabel={request?.cancelLabel || "Keep as is"}
      busy={busy}
      error={error}
      onConfirm={confirm}
      onCancel={close}
    >
      {request?.body}
    </ConfirmDialog>
  );

  return { ask, dialog, busy };
}
