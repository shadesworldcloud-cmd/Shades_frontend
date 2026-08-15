import React, { useState } from "react";
import { Link, useParams } from "react-router-dom";
import "./StoreInfo.css";
import ContactCareDialog from "../../components/ContactCareDialog/ContactCareDialog";

const pages = {
  about: {
    eyebrow: "Our story", title: "About Shades World Barcelona",
    intro: "Independent eyewear for people who see the world in their own way.",
    sections: [
      ["What we believe", "Eyewear should feel personal, dependable and effortless to shop for. We curate distinctive frames across men’s, women’s and unisex collections, with clear product information and variant-level photography."],
      ["How we work", "Our catalogue is maintained directly by our store team. Availability, pricing, offers and product imagery shown on the website come from the same store system used to fulfil customer orders."],
      ["Our promise", "We aim to make every stage transparent—from discovering the right frame to tracking delivery, requesting a return and receiving a refund update."],
    ],
  },
  contact: {
    eyebrow: "Customer care", title: "Contact us",
    intro: "We are here to help with products, orders, delivery, returns and account access.",
    sections: [
      ["Order help", "Sign in and open My Orders for order status, shipment tracking, invoice downloads and eligible return requests."],
      ["Email", "Write to iambhuvanmod@gmail.com. Include your order number when contacting us about an existing purchase. Never send passwords, one-time codes or payment credentials."],
      ["Response times", "Messages are handled during normal business days. Delivery and refund updates are also sent through your notification centre and registered email address."],
    ],
    action: ["Open My Orders", "/my-orders"],
  },
  shipping: {
    eyebrow: "Delivery guide", title: "Shipping & delivery",
    intro: "Straightforward delivery information from checkout through arrival.",
    sections: [
      ["Delivery charges", "Standard shipping is free when the qualifying merchandise subtotal is ₹500 or more. The exact shipping charge and final total are always shown before an order is placed."],
      ["Delivery estimate", "Standard delivery is normally 3–5 business days after dispatch. Remote locations, public holidays and courier disruptions may take longer."],
      ["Tracking", "Once the store team creates a shipment, the courier, tracking number, status and expected delivery date appear in My Orders. Shipment updates may also generate email and in-app notifications."],
      ["Check your address", "Review the recipient, phone number, pincode and complete address before placing the order. Contact customer care promptly if something is incorrect."],
    ],
    action: ["Track an order", "/my-orders"],
  },
  returns: {
    eyebrow: "After your purchase", title: "Returns & refunds",
    intro: "Eligible products can be requested for return within 30 days after recorded delivery.",
    sections: [
      ["Return eligibility", "The order must be marked delivered and the request must be submitted within 30 days of its delivery timestamp. The website will only offer items that are eligible under the recorded order."],
      ["Requesting a return", "Open My Orders, choose the delivered order, select the items and quantities, and provide the return reason. You can cancel a request while its current status still permits cancellation."],
      ["Inspection", "Returned items are inspected before completion. Keep the product, accessories and packaging together and avoid additional wear or damage."],
      ["Refunds", "Approved refunds are recorded against the original payment. Processing time after approval can vary by payment provider. Refund and return status remains available in My Orders and notifications."],
    ],
    action: ["Start a return", "/my-orders"],
  },
  faq: {
    eyebrow: "Quick answers", title: "Frequently asked questions",
    intro: "The most common questions about shopping with Shades World Barcelona.",
    faq: [
      ["Do I need an account to shop?", "You can browse without an account. Sign in is required to save a server-backed cart or wishlist, place an order, track delivery and request a return."],
      ["Will my cart remain after I sign out?", "Yes. Items in an authenticated customer’s cart are stored with that account and return after the customer signs in again."],
      ["How do product variants work?", "Select the main item or a colour variant on the product page. Variant imagery, availability and review information update for the selected option."],
      ["Where can I find my invoice?", "Open My Orders and use the invoice action for the relevant paid order."],
      ["How are offers applied?", "Enter an active offer code in Your Bag. Eligibility and discount calculations are validated by the store server before checkout."],
      ["Can I review a variant?", "Customers with an eligible purchased order item can submit a product or variant-level review. Reviews may be moderated before public display."],
    ],
  },
  "size-guide": {
    eyebrow: "Find your fit", title: "Eyewear size guide",
    intro: "Use the measurements printed on an existing comfortable frame as your best reference.",
    sections: [
      ["Reading frame measurements", "Most frames show three measurements in millimetres: lens width, bridge width and temple length—for example, 52–18–140."],
      ["Lens width", "The horizontal width of one lens. A few millimetres can noticeably change how wide a frame feels."],
      ["Bridge width", "The distance between the lenses where the frame rests on your nose. Compare this with a frame that sits securely without pinching."],
      ["Temple length", "The arm length from the hinge toward the ear. Choose a similar measurement to a frame that already fits comfortably."],
    ],
  },
  privacy: {
    eyebrow: "Your information", title: "Privacy policy",
    intro: "How Shades World Barcelona handles information required to operate the store.",
    sections: [
      ["Information we use", "Account details, delivery addresses, cart and wishlist contents, orders, payments recorded by the store, reviews, returns, refunds and support-related communications may be processed."],
      ["Why we use it", "Information is used to authenticate accounts, fulfil purchases, deliver orders, prevent abuse, provide customer support, send transactional notifications and improve store operations."],
      ["Google sign-in", "When you choose Google sign-in, the store uses verified identity information supplied by Google to create or access your customer account. The store never receives your Google password."],
      ["Cookies and security", "Authentication uses secure session cookies that JavaScript cannot read. A separate anti-forgery token protects state-changing requests. Essential cookies are required for signed-in functionality."],
      ["Sharing and retention", "Information is shared only as required for store operations, such as delivery and transactional email. Records are retained for operational, fraud-prevention and legal obligations."],
      ["Your choices", "You may update profile and address information in your account. Contact customer care for access, correction or deletion questions that cannot be handled through the website."],
    ],
  },
  terms: {
    eyebrow: "Store rules", title: "Terms & conditions",
    intro: "These terms explain the basic conditions for using the store and placing orders.",
    sections: [
      ["Accounts", "Provide accurate information and keep account access private. You are responsible for activity performed through your account. Notify customer care if you suspect unauthorised access."],
      ["Products and availability", "Product images aim to represent colour and appearance accurately, but screens can vary. Stock is confirmed by the store system and may change before checkout is completed."],
      ["Pricing and offers", "Prices, taxes, shipping charges and discounts shown in the final checkout summary govern the order. Offers are subject to their configured eligibility, validity period and usage conditions."],
      ["Orders", "An order may be reviewed or cancelled if payment is not completed, stock is unavailable, information is invalid or fraudulent activity is suspected."],
      ["Delivery, returns and refunds", "Delivery estimates are not guarantees. Returns and refunds follow the eligibility and workflow described on the Returns & Refunds page."],
      ["Acceptable use", "Do not attempt to bypass access controls, disrupt the service, automate abusive requests, misuse offers or access another customer’s data."],
    ],
  },
};

const StoreInfo = () => {
  const { page } = useParams();
  const content = pages[page];
  // Declared before the not-found return below, so the hook order is stable across both branches.
  const [contactOpen, setContactOpen] = useState(false);
  if (!content) return <main className="info-page"><div className="info-shell info-missing"><h1>Page not found</h1><Link to="/">Return home</Link></div></main>;
  return <main className="info-page">
    <header className="info-hero"><div className="info-shell"><span>{content.eyebrow}</span><h1>{content.title}</h1><p>{content.intro}</p></div></header>
    <div className="info-shell info-layout">
      <aside aria-label="Store information navigation">
        {Object.entries(pages).map(([key, item]) => <Link key={key} to={`/info/${key}`} className={key === page ? "active" : ""}>{item.title}</Link>)}
      </aside>
      <article>
        {content.sections?.map(([title, text]) => <section key={title}><h2>{title}</h2><p>{text}</p></section>)}
        {content.faq?.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}
        {content.action && <Link className="info-action" to={content.action[1]}>{content.action[0]} <span>→</span></Link>}
        {/* A button, not a Link. This was <Link to="/info/contact">, which on the contact page
            itself pointed at the page already open — so the action appeared dead. Opening the
            care sheet is also the more direct answer on every other info page, so both cases get
            the same behaviour instead of one navigating and one doing nothing. */}
        <div className="info-note"><strong>Need more help?</strong><p>Contact customer care and include your order number where relevant.</p>
          <button type="button" className="info-note-contact" onClick={() => setContactOpen(true)}>Contact us</button></div>
      </article>
    </div>
    <ContactCareDialog open={contactOpen} onClose={() => setContactOpen(false)} />
  </main>;
};

export default StoreInfo;
