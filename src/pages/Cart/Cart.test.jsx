import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Cart from "./Cart";
import { StoreContext } from "../../context/StoreContext";

jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ accessToken: "cookie-session" }) }));
jest.mock("../../services/api", () => ({ validateCoupon: jest.fn() }));

// Two active colours, one of them sold out: quantityAvailable 0 is a real cap, never
// "unknown" and never unlimited.
const rayban = {
  _id: "14", productId: 14, name: "Rayban", price: 1999, image: "/main.jpg", color: "Blue",
  images: [{ imageId: 4, imageUrl: "/blue.jpg", variantId: 13 }],
  variants: [
    { variantId: 13, sku: "SUL-001-BLUE", variantName: "Ocean Blue", price: 1999, quantityAvailable: 2, attributes: { color: "Blue" } },
    { variantId: 15, sku: "SKU-003-BLACK", variantName: "Ocean Black", price: 1999, quantityAvailable: 0, attributes: { color: "Black" } },
  ],
};

const view = (overrides = {}) => {
  const store = {
    cartItems: {}, product_list: [rayban], productsLoading: false, productsError: "",
    refreshProducts: jest.fn(), removeFromCart: jest.fn(), removeLineFromCart: jest.fn(), addToCart: jest.fn(),
    getTotalCartAmount: () => 0, appliedOffer: null, setAppliedOffer: jest.fn(), cartSyncing: false, ...overrides,
  };
  render(<MemoryRouter><StoreContext.Provider value={store}><Cart /></StoreContext.Provider></MemoryRouter>);
  return store;
};

test("a line whose product left the catalogue is still rendered, still counted and removable", () => {
  const store = view({ cartItems: { "14:13": 1, "99:77": 2 }, getTotalCartAmount: () => 1999 });
  expect(screen.getByText("Rayban")).toBeInTheDocument();
  expect(screen.getByText("Unavailable item")).toBeInTheDocument();
  expect(screen.getByText("Price unavailable")).toBeInTheDocument();
  // The summary counts exactly what the bag drew, so the badge cannot disagree with it.
  expect(screen.getByText("3 units")).toBeInTheDocument();
  // The only escape from the dead end: a Remove on the row, using the variantId parsed
  // out of the cart key rather than a product lookup that cannot succeed.
  fireEvent.click(screen.getByRole("button", { name: "Remove Unavailable item (ref 77) from bag" }));
  expect(store.removeLineFromCart).toHaveBeenCalledWith("99", 77);
});

test("checkout is blocked, not silently under-priced, while an unavailable line is in the bag", () => {
  view({ cartItems: { "14:13": 1, "99:77": 1 }, getTotalCartAmount: () => 1999 });
  expect(screen.getByRole("alert")).toHaveTextContent(/1 item in your bag is no longer available/i);
  expect(screen.getByRole("button", { name: /Remove unavailable items to continue/i })).toBeDisabled();
});

test("a deactivated colour of a live product degrades instead of borrowing the product price", () => {
  const store = view({ cartItems: { "14:21": 1 } });
  expect(screen.getByText("Rayban")).toBeInTheDocument();
  expect(screen.getByText(/This colour is no longer sold/)).toBeInTheDocument();
  expect(screen.getByText("Price unavailable")).toBeInTheDocument();
  expect(screen.queryByText("₹1,999")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove Rayban (ref 21) from bag" }));
  expect(store.removeLineFromCart).toHaveBeenCalledWith("14", 21);
});

test("the + button caps at the committed variant's own stock and never reads zero as unlimited", () => {
  view({ cartItems: { "14:13": 1, "14:15": 1 }, getTotalCartAmount: () => 3998 });
  expect(screen.getByRole("button", { name: "Increase quantity of Rayban in Blue" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "No more Rayban in Black available" })).toBeDisabled();
});

test("a bag waiting on the catalogue says so instead of claiming to be empty", () => {
  view({ cartItems: { "14:13": 2 }, product_list: [], productsLoading: true });
  expect(screen.getByRole("status")).toHaveTextContent(/Loading the 2 items in your bag/i);
  expect(screen.queryByText("Your bag is empty")).not.toBeInTheDocument();
});

test("a failed catalogue fetch offers a retry instead of an empty bag", () => {
  const store = view({ cartItems: { "14:13": 2 }, product_list: [], productsError: "Network error" });
  expect(screen.getByRole("alert")).toHaveTextContent(/catalogue could not be loaded/i);
  expect(screen.queryByText("Your bag is empty")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
  expect(store.refreshProducts).toHaveBeenCalled();
});

test("an empty bag is still reported as empty while the catalogue is loading", () => {
  view({ cartItems: {}, product_list: [], productsLoading: true });
  expect(screen.getByText("Your bag is empty")).toBeInTheDocument();
});
