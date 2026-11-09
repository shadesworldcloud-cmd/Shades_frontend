import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PlaceOrder from "./PlaceOrder";
import { StoreContext } from "../../context/StoreContext";
import * as api from "../../services/api";
import { clearDeliveryEstimateCache } from "../../services/deliveryEstimate";

jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ accessToken: "cookie-session" }) }));
jest.mock("../../services/api", () => ({
  createAddress: jest.fn(), createOrder: jest.fn(), processMockPayment: jest.fn(),
  getAddresses: jest.fn(), getDeliveryEstimate: jest.fn(),
}));

const store = {
  cartItems: { "19:21": 2 },
  product_list: [{ _id: "19", name: "Barcelona Sun", price: 123, image: "/frame.jpg", images: [],
    variants: [{ variantId: 21, variantName: "Ocean Blue", sku: "BAR-BLU", price: 123, attributes: { color: "Blue" } }] }],
  getTotalCartAmount: () => 246,
  appliedOffer: null,
  clearCartState: jest.fn(),
  getCartCount: () => 2,
  cartSyncing: false,
  // Checkout now displays and submits the server's quote rather than its own arithmetic, and will
  // not submit at all until that quote has arrived — the amount sent back as expectedTotalAmount has
  // to be the server's own figure. These are the numbers the server would return for two units at
  // ₹123 with no offer in force. Prices are tax-inclusive, so ₹246 of merchandise IS ₹246 to the
  // customer (₹208.47 net + ₹37.53 GST), plus ₹49 shipping under the free-shipping threshold.
  quote: {
    subtotal: 246, itemQuantity: 2, discount: 0, taxableAmount: 208.47,
    taxAmount: 37.53, shippingAmount: 49, totalAmount: 295,
    appliedPromotion: "NONE", appliedPromotionLabel: null,
    suppressedPromotionLabel: null, suppressedPromotionReason: null,
    automaticOffer: null, unresolvedVariantIds: [],
  },
  quoteLoading: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  clearDeliveryEstimateCache();
  window.sessionStorage.clear();
  api.getAddresses.mockResolvedValue([{ addressId: 4, recipientName: "Asha", addressLine1: "1 Market Street",
    city: "Barcelona", state: "Catalonia", pincode: "08001", country: "Spain", isDefault: true }]);
});

test("requires review of exact variants, address and final total before placing order", async () => {
  render(<MemoryRouter><StoreContext.Provider value={store}><PlaceOrder /></StoreContext.Provider></MemoryRouter>);
  expect(await screen.findByText("Barcelona Sun")).toBeInTheDocument();
  expect(screen.getByText(/Blue · BAR-BLU/)).toBeInTheDocument();
  expect(screen.getByText(/Quantity 2 × ₹123/)).toBeInTheDocument();
  expect((await screen.findAllByText("Asha")).length).toBeGreaterThan(0);
  await waitFor(() => expect(screen.queryByText(/Loading saved addresses/i)).not.toBeInTheDocument());
  // ₹295, not ₹339.28: prices are tax-inclusive, so the ₹246 of goods is not grossed up by 18%
  // before the ₹49 carriage is added. money() drops trailing zeros, hence "₹295".
  const submit = screen.getByRole("button", { name: /Place order · ₹295/i });
  expect(submit).toBeDisabled();
  const confirmation = screen.getByRole("checkbox", { name: /I reviewed the items, variants, quantities/i });
  fireEvent.click(confirmation);
  await waitFor(() => expect(submit).toBeEnabled());
});

// ---- Expected delivery date (Shiprocket) ----

const indianAddress = { addressId: 7, recipientName: "Ravi", addressLine1: "12 MG Road", city: "Bengaluru",
  state: "Karnataka", pincode: "560001", country: "India", isDefault: true };
const renderCheckout = () => render(<MemoryRouter><StoreContext.Provider value={store}><PlaceOrder /></StoreContext.Provider></MemoryRouter>);
const confirmReview = () => fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed the items, variants, quantities/i }));

test("checkout shows Shiprocket's expected delivery dates for the selected address", async () => {
  api.getAddresses.mockResolvedValue([indianAddress]);
  api.getDeliveryEstimate.mockResolvedValue({ pincode: "560001", serviceable: true, earliestDate: "2026-11-14",
    latestDate: "2026-11-17", courierName: "Xpressbees", courierCount: 2, source: "SHIPROCKET" });
  renderCheckout();

  const card = await screen.findByTestId("checkout-delivery-estimate");
  await waitFor(() => expect(card).toHaveTextContent(/Sat.*14.*Nov – Tue.*17.*Nov/));
  expect(card).toHaveTextContent("Expected delivery to 560001 via Xpressbees");
  expect(api.getDeliveryEstimate).toHaveBeenCalledWith("560001");
  confirmReview();
  await waitFor(() => expect(screen.getByRole("button", { name: /Place order/i })).toBeEnabled());
});

test("checkout cannot be placed to a pincode Shiprocket cannot deliver to", async () => {
  api.getAddresses.mockResolvedValue([{ ...indianAddress, pincode: "194101" }]);
  api.getDeliveryEstimate.mockResolvedValue({ pincode: "194101", serviceable: false, source: "SHIPROCKET" });
  renderCheckout();

  const card = await screen.findByTestId("checkout-delivery-estimate");
  await waitFor(() => expect(card).toHaveTextContent("Not deliverable to 194101"));
  confirmReview();
  expect(screen.getByRole("button", { name: /Place order/i })).toBeDisabled();
});

test("a Shiprocket outage shows the standard window and never blocks checkout", async () => {
  api.getAddresses.mockResolvedValue([indianAddress]);
  api.getDeliveryEstimate.mockRejectedValue(new Error("Service unavailable"));
  renderCheckout();

  const card = await screen.findByTestId("checkout-delivery-estimate");
  await waitFor(() => expect(card).toHaveTextContent("Standard delivery, 3–5 business days after dispatch"));
  confirmReview();
  await waitFor(() => expect(screen.getByRole("button", { name: /Place order/i })).toBeEnabled());
});

test("a new address looks up the delivery date once the pincode is complete", async () => {
  api.getAddresses.mockResolvedValue([]);
  api.getDeliveryEstimate.mockResolvedValue({ pincode: "110001", serviceable: true, earliestDate: "2026-11-13",
    latestDate: "2026-11-13", courierName: "Delhivery", courierCount: 1, source: "SHIPROCKET" });
  renderCheckout();
  const pincode = await screen.findByLabelText("PIN code");
  fireEvent.change(pincode, { target: { value: "1100" } });
  expect(api.getDeliveryEstimate).not.toHaveBeenCalled();
  fireEvent.change(pincode, { target: { value: "110001" } });
  const card = screen.getByTestId("checkout-delivery-estimate");
  await waitFor(() => expect(card).toHaveTextContent(/Fri.*13.*Nov/));
  expect(api.getDeliveryEstimate).toHaveBeenCalledWith("110001");
});

test("international addresses show the standard window without a Shiprocket lookup", async () => {
  renderCheckout(); // default fixture address is in Spain
  const card = await screen.findByTestId("checkout-delivery-estimate");
  await waitFor(() => expect(card).toHaveTextContent("Standard delivery, 3–5 business days after dispatch"));
  expect(api.getDeliveryEstimate).not.toHaveBeenCalled();
});
