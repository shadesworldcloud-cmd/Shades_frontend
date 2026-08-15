import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import StoreContextProvider, { StoreContext } from "./StoreContext";
import { useContext } from "react";
import * as api from "../services/api";

const mockAuth = { accessToken:"cookie-session", user:{ userId:7 }, isAdmin:false };
jest.mock("./AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../services/api", () => ({ getStoreProducts:jest.fn(), getCart:jest.fn(), updateCartItem:jest.fn(),
  addCartItem:jest.fn(), removeCartItem:jest.fn(), getWishlist:jest.fn(), addWishlistItem:jest.fn(), removeWishlistItem:jest.fn(),
  // The store asks the server to price the bag whenever it changes. Stubbed because these tests are
  // about cart state rather than money; beforeEach resolves it to an empty quote.
  quoteCart:jest.fn() }));

function Harness() { const store = useContext(StoreContext); return <><output aria-label="quantity">{store.cartItems["14:13"] || 0}</output><output aria-label="pink quantity">{store.cartItems["14:14"] || 0}</output><output aria-label="cart error">{store.cartError}</output><output aria-label="products">{store.product_list.length}</output><button onClick={() => store.addToCart("14",13)}>add blue</button><button onClick={() => store.addToCart("14",14)}>add pink</button><button onClick={() => store.removeFromCart("14",13)}>decrease</button></>; }

const rejection = (message, status) => Object.assign(new Error(message), { status });

beforeEach(() => {
  jest.clearAllMocks();
  // The guest bag is persisted now, so it would otherwise carry between tests in this file.
  window.localStorage.clear();
  Object.assign(mockAuth, { accessToken:"cookie-session", user:{ userId:7 }, isAdmin:false });
  api.getStoreProducts.mockResolvedValue({ content:[] }); api.getWishlist.mockResolvedValue({ items:[] });
  api.getCart.mockResolvedValue({ items:[{ productId:14, variantId:13, quantity:3 }] });
  api.updateCartItem.mockResolvedValue({ items:[] }); api.removeCartItem.mockResolvedValue({ items:[] });
  api.quoteCart.mockResolvedValue(null);
});

test("rapid decrements use the latest intended quantity and are serialized", async () => {
  render(<StoreContextProvider><Harness /></StoreContextProvider>);
  await waitFor(() => expect(screen.getByLabelText("quantity")).toHaveTextContent("3"));
  fireEvent.click(screen.getByRole("button", { name:"decrease" }));
  fireEvent.click(screen.getByRole("button", { name:"decrease" }));
  expect(screen.getByLabelText("quantity")).toHaveTextContent("1");
  await waitFor(() => expect(api.updateCartItem).toHaveBeenCalledTimes(2));
  expect(api.updateCartItem.mock.calls.map((call) => call[2])).toEqual([2,1]);
});

test("sign in merges a guest variant with an existing remote variant", async () => {
  Object.assign(mockAuth, { accessToken:null, user:null, isAdmin:false });
  api.getCart.mockResolvedValue({ items:[{ productId:14, variantId:14, quantity:2 }] });
  api.addCartItem.mockResolvedValue({ items:[
    { productId:14, variantId:13, quantity:1 }, { productId:14, variantId:14, quantity:2 },
  ] });
  const tree = <StoreContextProvider><Harness /></StoreContextProvider>;
  const { rerender } = render(tree);
  fireEvent.click(screen.getByRole("button", { name:"add blue" }));
  expect(screen.getByLabelText("quantity")).toHaveTextContent("1");

  Object.assign(mockAuth, { accessToken:"cookie-session", user:{ userId:7 } });
  rerender(<StoreContextProvider><Harness /></StoreContextProvider>);

  await waitFor(() => expect(api.addCartItem).toHaveBeenCalledWith("cookie-session", 13, 1));
  await waitFor(() => expect(screen.getByLabelText("pink quantity")).toHaveTextContent("2"));
  expect(screen.getByLabelText("quantity")).toHaveTextContent("1");
});

test("a failed mutation keeps the newer successful response and does not reconcile mid-queue", async () => {
  api.updateCartItem.mockRejectedValueOnce(rejection("Only 2 units available for AV-BLK-52", 400))
    .mockResolvedValue({ items:[{ productId:14, variantId:13, quantity:1 }] });
  render(<StoreContextProvider><Harness /></StoreContextProvider>);
  await waitFor(() => expect(screen.getByLabelText("quantity")).toHaveTextContent("3"));
  fireEvent.click(screen.getByRole("button", { name:"decrease" }));
  fireEvent.click(screen.getByRole("button", { name:"decrease" }));
  await waitFor(() => expect(api.updateCartItem).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByLabelText("cart error")).toHaveTextContent("Only 2 units available for AV-BLK-52"));
  expect(screen.getByLabelText("quantity")).toHaveTextContent("1");
  expect(api.getCart).toHaveBeenCalledTimes(1);
});

test("the newest mutation still reconciles when it is the one that fails", async () => {
  api.updateCartItem.mockRejectedValue(rejection("Item not found in cart", 404));
  api.getCart.mockResolvedValueOnce({ items:[{ productId:14, variantId:13, quantity:3 }] })
    .mockResolvedValue({ items:[{ productId:14, variantId:13, quantity:5 }] });
  render(<StoreContextProvider><Harness /></StoreContextProvider>);
  await waitFor(() => expect(screen.getByLabelText("quantity")).toHaveTextContent("3"));
  fireEvent.click(screen.getByRole("button", { name:"decrease" }));
  await waitFor(() => expect(api.getCart).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByLabelText("quantity")).toHaveTextContent("5"));
  expect(screen.getByLabelText("cart error")).toHaveTextContent("Item not found in cart");
});

test("sign in adds only the shortfall for a variant the account already holds", async () => {
  Object.assign(mockAuth, { accessToken:null, user:null, isAdmin:false });
  api.getCart.mockResolvedValue({ items:[{ productId:14, variantId:13, quantity:1 }] });
  api.addCartItem.mockResolvedValue({ items:[{ productId:14, variantId:13, quantity:2 }] });
  const { rerender } = render(<StoreContextProvider><Harness /></StoreContextProvider>);
  fireEvent.click(screen.getByRole("button", { name:"add blue" }));
  fireEvent.click(screen.getByRole("button", { name:"add blue" }));
  expect(screen.getByLabelText("quantity")).toHaveTextContent("2");

  Object.assign(mockAuth, { accessToken:"cookie-session", user:{ userId:7 } });
  rerender(<StoreContextProvider><Harness /></StoreContextProvider>);

  await waitFor(() => expect(api.addCartItem).toHaveBeenCalledTimes(1));
  expect(api.addCartItem).toHaveBeenCalledWith("cookie-session", 13, 1);
  await waitFor(() => expect(screen.getByLabelText("quantity")).toHaveTextContent("2"));
  expect(api.addCartItem).toHaveBeenCalledTimes(1);
});

test("sign in skips a line the account already holds in full", async () => {
  Object.assign(mockAuth, { accessToken:null, user:null, isAdmin:false });
  api.getCart.mockResolvedValue({ items:[{ productId:14, variantId:13, quantity:4 }] });
  const { rerender } = render(<StoreContextProvider><Harness /></StoreContextProvider>);
  fireEvent.click(screen.getByRole("button", { name:"add blue" }));

  Object.assign(mockAuth, { accessToken:"cookie-session", user:{ userId:7 } });
  rerender(<StoreContextProvider><Harness /></StoreContextProvider>);

  await waitFor(() => expect(screen.getByLabelText("quantity")).toHaveTextContent("4"));
  expect(api.addCartItem).not.toHaveBeenCalled();
});

test("one failing merge line does not discard the lines queued after it", async () => {
  Object.assign(mockAuth, { accessToken:null, user:null, isAdmin:false });
  api.getCart.mockResolvedValue({ items:[] });
  api.addCartItem.mockRejectedValueOnce(rejection("Only 0 units available for AV-BLK-52", 400))
    .mockResolvedValue({ items:[{ productId:14, variantId:14, quantity:1 }] });
  const { rerender } = render(<StoreContextProvider><Harness /></StoreContextProvider>);
  fireEvent.click(screen.getByRole("button", { name:"add blue" }));
  fireEvent.click(screen.getByRole("button", { name:"add pink" }));

  Object.assign(mockAuth, { accessToken:"cookie-session", user:{ userId:7 } });
  rerender(<StoreContextProvider><Harness /></StoreContextProvider>);

  await waitFor(() => expect(api.addCartItem).toHaveBeenCalledTimes(2));
  expect(api.addCartItem.mock.calls.map((call) => call[1])).toEqual([13,14]);
  await waitFor(() => expect(screen.getByLabelText("pink quantity")).toHaveTextContent("1"));
  expect(screen.getByLabelText("quantity")).toHaveTextContent("0");
  expect(screen.getByLabelText("cart error")).toHaveTextContent("Only 0 units available for AV-BLK-52");
});

test("sign in clamps a guest quantity to the stock it knows about", async () => {
  Object.assign(mockAuth, { accessToken:null, user:null, isAdmin:false });
  api.getStoreProducts.mockResolvedValue({ content:[{ productId:14, productName:"Aviator", basePrice:100,
    variants:[{ variantId:13, isActive:true, price:100, quantityAvailable:2 }] }] });
  api.getCart.mockResolvedValue({ items:[] });
  api.addCartItem.mockResolvedValue({ items:[{ productId:14, variantId:13, quantity:2 }] });
  // The bag was saved while three were still available and stock has since fallen to two, so
  // it is seeded rather than clicked — addToCart now refuses to exceed the stock it can see,
  // which makes an over-stock bag unreachable through the UI. The merge must still clamp it.
  window.localStorage.setItem("shades_world_guest_cart",
    JSON.stringify({ version:1, savedAt:Date.now(), items:{ "14:13":3 } }));
  const { rerender } = render(<StoreContextProvider><Harness /></StoreContextProvider>);
  await waitFor(() => expect(screen.getByLabelText("products")).toHaveTextContent("1"));
  expect(screen.getByLabelText("quantity")).toHaveTextContent("3");

  Object.assign(mockAuth, { accessToken:"cookie-session", user:{ userId:7 } });
  rerender(<StoreContextProvider><Harness /></StoreContextProvider>);

  await waitFor(() => expect(api.addCartItem).toHaveBeenCalledWith("cookie-session", 13, 2));
  await waitFor(() => expect(screen.getByLabelText("quantity")).toHaveTextContent("2"));
  expect(screen.getByLabelText("cart error")).toHaveTextContent("Only 2 left of Aviator.");
});

test("a merge line the server rejects is dropped rather than left showing", async () => {
  Object.assign(mockAuth, { accessToken:null, user:null, isAdmin:false });
  api.getCart.mockResolvedValue({ items:[] });
  api.addCartItem.mockRejectedValue(rejection("Only 0 units available for AV-BLK-52", 400));
  const { rerender } = render(<StoreContextProvider><Harness /></StoreContextProvider>);
  fireEvent.click(screen.getByRole("button", { name:"add blue" }));
  expect(screen.getByLabelText("quantity")).toHaveTextContent("1");

  Object.assign(mockAuth, { accessToken:"cookie-session", user:{ userId:7 } });
  rerender(<StoreContextProvider><Harness /></StoreContextProvider>);

  await waitFor(() => expect(api.getCart).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByLabelText("quantity")).toHaveTextContent("0"));
  expect(api.addCartItem).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("cart error")).toHaveTextContent("Only 0 units available for AV-BLK-52");
});

test("a guest cart never touches the cart endpoints", async () => {
  Object.assign(mockAuth, { accessToken:null, user:null, isAdmin:false });
  render(<StoreContextProvider><Harness /></StoreContextProvider>);
  fireEvent.click(screen.getByRole("button", { name:"add blue" }));
  fireEvent.click(screen.getByRole("button", { name:"add blue" }));
  fireEvent.click(screen.getByRole("button", { name:"decrease" }));
  expect(screen.getByLabelText("quantity")).toHaveTextContent("1");
  await waitFor(() => expect(api.getStoreProducts).toHaveBeenCalled());
  expect(api.getCart).not.toHaveBeenCalled();
  expect(api.addCartItem).not.toHaveBeenCalled();
  expect(api.updateCartItem).not.toHaveBeenCalled();
});
