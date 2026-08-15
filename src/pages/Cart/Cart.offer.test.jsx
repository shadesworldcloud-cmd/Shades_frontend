import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Cart from "./Cart";
import { StoreContext } from "../../context/StoreContext";

jest.mock("../../services/api", () => ({ validateCoupon: jest.fn() }));
jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ accessToken: "cookie-session" }) }));

/**
 * What the bag says about the offer.
 *
 * The numbers themselves are the server's and are proven end to end elsewhere; what these tests pin
 * is that the bag renders the server's figures rather than any of its own, and that it says nothing
 * about a discount before the server has quoted one — a discount that appears and then changes is
 * worse than one that appears a moment later.
 */
const product = {
  _id: "19", name: "Barcelona Sun", price: 1000, image: "/frame.jpg", images: [],
  variants: [
    { variantId: 21, variantName: "Ocean Blue", sku: "BAR-BLU", price: 1000, quantityAvailable: 10, attributes: { color: "Blue" } },
    { variantId: 22, variantName: "Sand", sku: "BAR-SND", price: 1000, quantityAvailable: 10, attributes: { color: "Sand" } },
  ],
};

const baseStore = (overrides = {}) => ({
  cartItems: { "19:21": 3 },
  product_list: [product],
  productsLoading: false,
  productsError: "",
  refreshProducts: jest.fn(),
  removeFromCart: jest.fn(),
  removeLineFromCart: jest.fn(),
  addToCart: jest.fn(),
  getTotalCartAmount: () => 3000,
  appliedOffer: null,
  setAppliedOffer: jest.fn(),
  cartSyncing: false,
  quote: null,
  quoteLoading: false,
  ...overrides,
});

const quoteWithOffer = (overrides = {}) => ({
  subtotal: 3000, itemQuantity: 3, discount: 500, taxableAmount: 2500,
  taxAmount: 450, shippingAmount: 0, totalAmount: 2950,
  appliedPromotion: "AUTOMATIC_OFFER", appliedPromotionLabel: "Weekend pair offer",
  suppressedPromotionLabel: null, suppressedPromotionReason: null,
  automaticOffer: {
    automaticOfferId: 3, offerName: "Weekend pair offer",
    termsMessage: "₹500 off every 2 eligible units. Unmatched units are not discounted.",
    requiredQuantity: 2, discountPerGroup: 500, eligibleQuantity: 3, eligibleSubtotal: 3000,
    completeGroups: 1, discount: 500, unitsToNextGroup: 1,
    progressMessage: "Add 1 more eligible item to receive another ₹500 discount.",
    eligibleVariantIds: [21, 22],
  },
  unresolvedVariantIds: [],
  ...overrides,
});

const renderCart = (store) => render(
  <MemoryRouter><StoreContext.Provider value={store}><Cart /></StoreContext.Provider></MemoryRouter>);

describe("Cart automatic offer", () => {
  test("shows the offer, its terms, the group arithmetic, the discount and the next-group nudge", () => {
    renderCart(baseStore({ quote: quoteWithOffer() }));

    expect(screen.getByTestId("cart-automatic-offer")).toHaveTextContent("Weekend pair offer");
    expect(screen.getByTestId("cart-automatic-offer")).toHaveTextContent(/₹500 off every 2 eligible units/);
    expect(screen.getByTestId("cart-offer-calc")).toHaveTextContent(/1 qualifying group × ₹500/);
    expect(screen.getByTestId("cart-offer-discount")).toHaveTextContent("−₹500");
    expect(screen.getByTestId("cart-offer-progress"))
      .toHaveTextContent("Add 1 more eligible item to receive another ₹500 discount.");
  });

  test("the discount carries an accessible label so it is not announced as a bare number", () => {
    renderCart(baseStore({ quote: quoteWithOffer() }));

    expect(screen.getByLabelText(/Offer discount ₹500/)).toBeInTheDocument();
  });

  test("no discount is shown before the server has priced the bag", () => {
    renderCart(baseStore({ quote: null, quoteLoading: true }));

    expect(screen.queryByTestId("cart-automatic-offer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cart-offer-discount")).not.toBeInTheDocument();
    expect(screen.getByText(/Pricing your bag/)).toBeInTheDocument();
  });

  test("an offer in force with nothing qualifying yet shows progress but no discount row", () => {
    renderCart(baseStore({
      cartItems: { "19:21": 1 },
      getTotalCartAmount: () => 1000,
      quote: quoteWithOffer({
        subtotal: 1000, itemQuantity: 1, discount: 0, taxableAmount: 1000, taxAmount: 180,
        shippingAmount: 0, totalAmount: 1180, appliedPromotion: "NONE", appliedPromotionLabel: null,
        automaticOffer: { ...quoteWithOffer().automaticOffer, eligibleQuantity: 1, completeGroups: 0, discount: 0 },
      }),
    }));

    expect(screen.getByTestId("cart-automatic-offer")).toBeInTheDocument();
    expect(screen.queryByTestId("cart-offer-calc")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cart-offer-discount")).not.toBeInTheDocument();
    expect(screen.getByTestId("cart-offer-progress")).toBeInTheDocument();
  });

  test("a suppressed coupon is explained rather than silently dropped", () => {
    renderCart(baseStore({
      quote: quoteWithOffer({
        suppressedPromotionLabel: "Coupon SAVE200",
        suppressedPromotionReason:
          "Your automatic offer saves more, so Coupon SAVE200 was not applied. These cannot be combined.",
      }),
    }));

    expect(screen.getByTestId("cart-offer-suppressed"))
      .toHaveTextContent(/Coupon SAVE200 was not applied\. These cannot be combined\./);
  });

  test("a scoped offer marks which lines count and which do not", () => {
    renderCart(baseStore({
      cartItems: { "19:21": 2, "19:22": 1 },
      getTotalCartAmount: () => 3000,
      quote: quoteWithOffer({
        automaticOffer: { ...quoteWithOffer().automaticOffer, eligibleVariantIds: [21] },
      }),
    }));

    expect(screen.getByText("Counts toward the offer")).toBeInTheDocument();
    expect(screen.getByText("Not eligible for this offer")).toBeInTheDocument();
  });

  test("an all-products offer does not label every line, which would be noise", () => {
    renderCart(baseStore({
      cartItems: { "19:21": 2, "19:22": 1 },
      getTotalCartAmount: () => 3000,
      quote: quoteWithOffer({
        automaticOffer: { ...quoteWithOffer().automaticOffer, eligibleVariantIds: [21, 22] },
      }),
    }));

    expect(screen.queryByText("Counts toward the offer")).not.toBeInTheDocument();
    expect(screen.queryByText("Not eligible for this offer")).not.toBeInTheDocument();
  });

  test("the totals rendered are the server's, not a client recalculation", () => {
    // A deliberately inconsistent quote: if the bag were recomputing tax or the total from the
    // subtotal it would disagree with these figures, and this test would catch it.
    renderCart(baseStore({
      quote: quoteWithOffer({ taxAmount: 111.11, shippingAmount: 22.22, totalAmount: 999.99 }),
    }));

    expect(screen.getByText("₹111.11")).toBeInTheDocument();
    expect(screen.getByText("₹22.22")).toBeInTheDocument();
    expect(screen.getByText("₹999.99")).toBeInTheDocument();
  });
});
