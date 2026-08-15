import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useContext } from "react";
import StoreContextProvider, { StoreContext } from "./StoreContext";
import * as api from "../services/api";

const KEY = "shades_world_guest_cart";
const mockAuth = { accessToken: null, user: null, isAdmin: false };
jest.mock("./AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../services/api", () => ({ getStoreProducts: jest.fn(), getCart: jest.fn(), updateCartItem: jest.fn(),
  addCartItem: jest.fn(), removeCartItem: jest.fn(), getWishlist: jest.fn(), addWishlistItem: jest.fn(), removeWishlistItem: jest.fn(),
  quoteCart: jest.fn() }));

function Harness() {
  const store = useContext(StoreContext);
  return <>
    <output aria-label="blue">{store.cartItems["20:22"] || 0}</output>
    <output aria-label="orange">{store.cartItems["20:23"] || 0}</output>
    <button onClick={() => store.addToCart("20", 22)}>add blue</button>
    <button onClick={() => store.removeFromCart("20", 22)}>remove blue</button>
  </>;
}
const seed = (items) => window.localStorage.setItem(KEY, JSON.stringify({ version: 1, savedAt: Date.now(), items }));
const storedItems = () => { const raw = window.localStorage.getItem(KEY); return raw ? JSON.parse(raw).items : null; };

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  Object.assign(mockAuth, { accessToken: null, user: null, isAdmin: false });
  api.getStoreProducts.mockResolvedValue({ content: [] });
  api.getWishlist.mockResolvedValue({ items: [] });
  api.quoteCart.mockResolvedValue(null);
  api.getCart.mockResolvedValue({ items: [] });
  api.addCartItem.mockResolvedValue({ items: [] });
});

test("a guest bag survives a remount, which is what a hard refresh does", () => {
  const { unmount } = render(<StoreContextProvider><Harness /></StoreContextProvider>);
  fireEvent.click(screen.getByRole("button", { name: "add blue" }));
  fireEvent.click(screen.getByRole("button", { name: "add blue" }));
  expect(screen.getByLabelText("blue")).toHaveTextContent("2");
  unmount();

  render(<StoreContextProvider><Harness /></StoreContextProvider>);
  expect(screen.getByLabelText("blue")).toHaveTextContent("2");
});

test("a guest never calls the cart endpoints", () => {
  render(<StoreContextProvider><Harness /></StoreContextProvider>);
  fireEvent.click(screen.getByRole("button", { name: "add blue" }));
  expect(api.addCartItem).not.toHaveBeenCalled();
  expect(api.getCart).not.toHaveBeenCalled();
});

test("removing the last guest item clears storage instead of resurrecting it on reload", () => {
  const { unmount } = render(<StoreContextProvider><Harness /></StoreContextProvider>);
  fireEvent.click(screen.getByRole("button", { name: "add blue" }));
  fireEvent.click(screen.getByRole("button", { name: "remove blue" }));
  expect(storedItems()).toBeNull();
  unmount();

  render(<StoreContextProvider><Harness /></StoreContextProvider>);
  expect(screen.getByLabelText("blue")).toHaveTextContent("0");
});

test("a restored guest bag is merged into the account on sign-in, then the guest copy is dropped", async () => {
  seed({ "20:22": 2 });
  api.getCart.mockResolvedValue({ items: [] });
  api.addCartItem.mockResolvedValue({ items: [{ productId: 20, variantId: 22, quantity: 2 }] });

  const { rerender } = render(<StoreContextProvider><Harness /></StoreContextProvider>);
  expect(screen.getByLabelText("blue")).toHaveTextContent("2");

  Object.assign(mockAuth, { accessToken: "cookie-session", user: { userId: 7 } });
  rerender(<StoreContextProvider><Harness /></StoreContextProvider>);

  await waitFor(() => expect(api.addCartItem).toHaveBeenCalledWith("cookie-session", 22, 2));
  // Without this the bag would be re-merged on every authenticated reload, resurrecting
  // anything the customer deleted after signing in.
  await waitFor(() => expect(window.localStorage.getItem(KEY)).toBeNull());
});

test("an authenticated bag is never written to guest storage", async () => {
  Object.assign(mockAuth, { accessToken: "cookie-session", user: { userId: 7 } });
  api.getCart.mockResolvedValue({ items: [{ productId: 20, variantId: 23, quantity: 4 }] });
  render(<StoreContextProvider><Harness /></StoreContextProvider>);

  await waitFor(() => expect(screen.getByLabelText("orange")).toHaveTextContent("4"));
  expect(window.localStorage.getItem(KEY)).toBeNull();
});

test("signing out clears the bag rather than leaking it into the next guest session", async () => {
  Object.assign(mockAuth, { accessToken: "cookie-session", user: { userId: 7 } });
  api.getCart.mockResolvedValue({ items: [{ productId: 20, variantId: 23, quantity: 4 }] });
  const { rerender } = render(<StoreContextProvider><Harness /></StoreContextProvider>);
  await waitFor(() => expect(screen.getByLabelText("orange")).toHaveTextContent("4"));

  Object.assign(mockAuth, { accessToken: null, user: null });
  rerender(<StoreContextProvider><Harness /></StoreContextProvider>);

  await waitFor(() => expect(screen.getByLabelText("orange")).toHaveTextContent("0"));
  expect(window.localStorage.getItem(KEY)).toBeNull();
});

test("a failed merge keeps the guest bag, because it is still the only copy", async () => {
  seed({ "20:22": 1 });
  api.getCart.mockRejectedValue(new Error("Network down"));

  const { rerender } = render(<StoreContextProvider><Harness /></StoreContextProvider>);
  Object.assign(mockAuth, { accessToken: "cookie-session", user: { userId: 7 } });
  rerender(<StoreContextProvider><Harness /></StoreContextProvider>);

  await waitFor(() => expect(api.getCart).toHaveBeenCalled());
  expect(storedItems()).toEqual({ "20:22": 1 });
});

test("a burst of adds cannot exceed known stock, which a disabled button alone cannot guarantee", async () => {
  api.getStoreProducts.mockResolvedValue({ content: [{
    productId: 20, productName: "OBA", basePrice: 1999, isActive: true, categories: [], images: [],
    variants: [{ variantId: 22, sku: "SKU1", variantName: "Blue", price: 1999, quantityAvailable: 3, isActive: true, attributes: {} }],
  }] });
  render(<StoreContextProvider><Harness /></StoreContextProvider>);
  await waitFor(() => expect(api.getStoreProducts).toHaveBeenCalled());

  // Seven synchronous clicks: every one lands before React re-renders and disables the button.
  const add = screen.getByRole("button", { name: "add blue" });
  for (let i = 0; i < 7; i += 1) fireEvent.click(add);

  await waitFor(() => expect(screen.getByLabelText("blue")).toHaveTextContent("3"));
  expect(storedItems()).toEqual({ "20:22": 3 });
});

test("stock that the catalogue does not know about is not clamped to zero", async () => {
  // product_list empty: an unknown ceiling must not block the shopper, the server decides.
  render(<StoreContextProvider><Harness /></StoreContextProvider>);
  const add = screen.getByRole("button", { name: "add blue" });
  fireEvent.click(add); fireEvent.click(add);
  expect(screen.getByLabelText("blue")).toHaveTextContent("2");
});
