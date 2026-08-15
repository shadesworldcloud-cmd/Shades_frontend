import { useState } from "react";
import "./ContactCareDialog.css";
import ConfirmDialog from "../ConfirmDialog/ConfirmDialog";

/**
 * Contact Customer Care sheet.
 *
 * Built on ConfirmDialog rather than beside it, so the focus trap, Escape handling, backdrop
 * behaviour, scroll lock, focus restoration and dialog semantics are the ones the rest of the app
 * already uses. It passes no onConfirm: there is nothing to confirm here, only two ways to reach
 * customer care and a Close.
 *
 * Both actions are real anchors, not window.open. That matters for three of the requirements at
 * once: nothing can leave a broken blank window behind, a popup blocker cannot swallow the action,
 * and the address and number stay readable on screen either way — so the panel is still useful even
 * if the browser refuses to navigate.
 *
 * The order number is typed by the customer, never read from an order. This page has no order
 * context, and inventing one — or fetching somebody's orders into a public info page — is exactly
 * what the brief rules out. An empty box simply omits it from the message.
 */

export const SUPPORT_EMAIL = "shadesworldindia11@gmail.com";
/** Digits only, country code first: the form wa.me requires. */
export const WHATSAPP_LINK_NUMBER = "918233511042";
/** How the number is shown to a human. */
export const WHATSAPP_DISPLAY_NUMBER = "+91 8233511042";
const BASE_MESSAGE = "Hello Shades World customer care, I need help with my order.";

/** The prefilled message, with the order number appended only when one was actually typed. */
export const careMessage = (orderNumber) => {
  const trimmed = String(orderNumber || "").trim();
  return trimmed ? `${BASE_MESSAGE} My order number is ${trimmed}.` : BASE_MESSAGE;
};

/** encodeURIComponent, so spaces and punctuation survive the query string intact. */
export const whatsappUrl = (orderNumber) =>
  `https://wa.me/${WHATSAPP_LINK_NUMBER}?text=${encodeURIComponent(careMessage(orderNumber))}`;

export const mailtoUrl = (orderNumber) => {
  const subject = encodeURIComponent("Shades World customer care");
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${encodeURIComponent(careMessage(orderNumber))}`;
};

export default function ContactCareDialog({ open, onClose }) {
  const [orderNumber, setOrderNumber] = useState("");

  return (
    <ConfirmDialog open={open} title="Contact Customer Care" cancelLabel="Close" onCancel={onClose}>
      <p>Contact customer care and include your order number where relevant. We reply during Indian business hours.</p>

      <label className="contact-care-order">
        Order number (optional)
        <input value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)}
          placeholder="e.g. 1042" maxLength="40" autoComplete="off" />
      </label>

      <ul className="contact-care-options">
        <li>
          <span className="contact-care-label">Email</span>
          <strong>{SUPPORT_EMAIL}</strong>
          <a className="contact-care-action" href={mailtoUrl(orderNumber)}>Email customer care</a>
        </li>
        <li>
          <span className="contact-care-label">WhatsApp only</span>
          <strong>{WHATSAPP_DISPLAY_NUMBER}</strong>
          {/* Said twice on purpose: the label above is the heading, and this is the line a
              customer reads before tapping. This number does not take voice calls. */}
          <small>This number is WhatsApp only — it does not accept phone calls.</small>
          <a className="contact-care-action contact-care-whatsapp" href={whatsappUrl(orderNumber)}
            target="_blank" rel="noopener noreferrer">Message on WhatsApp</a>
        </li>
      </ul>
    </ConfirmDialog>
  );
}
