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
      ["Our promise", "We aim to make every stage transparent—from discovering the right frame to tracking delivery and requesting an exchange."],
    ],
  },
  contact: {
    eyebrow: "Customer care", title: "Contact us",
    intro: "We are here to help with products, orders, delivery, exchanges and account access.",
    sections: [
      ["Order help", "Sign in and open My Orders for order status, shipment tracking, invoice downloads and eligible exchange requests."],
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
    eyebrow: "After your purchase", title: "Exchanges",
    intro: "We offer exchanges within 7 days of delivery. Please review the eligibility conditions below.",
    sections: [
      ["Exchange eligibility", "The order must be marked as delivered and the exchange request must be submitted within 7 days of the delivery date. The product must be unused, unworn, undamaged and returned with its original packaging, box, tags and all accessories."],
      ["Reporting issues", "If you receive a damaged, defective or incorrect product, report it within 48 hours of delivery with clear photographs or video evidence. Items damaged due to misuse, scratches, accidents or improper handling are not eligible."],
      ["Requesting an exchange", "Open My Orders, select the delivered order, choose the eligible items and quantities, and provide the reason for exchange. You may cancel a request while its current status still permits cancellation."],
      ["Availability and pricing", "All exchanges are subject to product availability. If the replacement product differs in price from the original, the customer is responsible for paying the difference."],
      ["Refund policy", "We do not offer refunds for change of mind, incorrect selection or personal preference. Refunds are only processed in cases where an exchange cannot be fulfilled due to stock unavailability, subject to review and approval."],
    ],
    action: ["Request an exchange", "/my-orders"],
  },
  faq: {
    eyebrow: "Quick answers", title: "Frequently asked questions",
    intro: "The most common questions about shopping with Shades World Barcelona.",
    faq: [
      ["Do I need an account to shop?", "You can browse without an account. Sign in is required to save a server-backed cart or wishlist, place an order, track delivery and request an exchange."],
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
    eyebrow: "Store policies", title: "Terms & conditions",
    intro: "By placing an order on Shades World Barcelona, you acknowledge and agree to the following terms. Please read them carefully before making a purchase.",
    sections: [
      ["Exchange policy", "We offer a 7-day exchange window from the date of delivery. To be eligible, products must be unused, unworn, undamaged and returned in their original packaging along with the box, tags and all accessories."],
      ["No returns or refunds", "We do not offer returns or refunds for change of mind, incorrect selection or personal preference. All sales are considered final unless the product qualifies for an exchange under the conditions stated above."],
      ["Damaged or defective products", "If you receive a damaged, defective or incorrect product, you must report it within 48 hours of delivery with clear photographs or video evidence. Products damaged due to misuse, scratches, accidents or improper handling after delivery are not eligible for exchange."],
      ["Exchange availability", "All exchanges are subject to product availability at the time of processing. If a price difference exists between the original and replacement product, the balance is payable by the customer."],
      ["Accounts", "Provide accurate information and keep your account credentials private. You are responsible for all activity performed through your account. Notify customer care immediately if you suspect unauthorised access."],
      ["Products and availability", "Product images aim to represent colour and appearance as accurately as possible; however, slight variations may occur due to screen settings. Stock availability is confirmed by the store system and may change before checkout is completed."],
      ["Pricing and offers", "Prices, applicable taxes, shipping charges and discounts displayed in the final checkout summary govern the order. Promotional offers are subject to their configured eligibility criteria, validity period and usage conditions."],
      ["Orders", "An order may be reviewed, held or cancelled if payment is not completed, stock becomes unavailable, provided information is found to be invalid or fraudulent activity is suspected."],
      ["Shipping and delivery", "Shipping and delivery timelines are estimated and may vary due to courier delays, public holidays or unforeseen circumstances. Estimated delivery dates are not guaranteed."],
      ["Acceptable use", "You agree not to attempt to bypass access controls, disrupt the service, submit automated or abusive requests, misuse promotional offers or access another customer’s data."],
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
