import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ProductCard from "./ProductCard";
import { StoreContext } from "../../context/StoreContext";

jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

// price (1799) is the product-level minimum and belongs to a different, cheaper colour.
// variantPrice (1999) is the price of variant 13, which is the one this card commits.
const base = { id: "14", name: "Rayban", price: 1799, variantPrice: 1999, priceFrom: 1799,
  image: "/blue.jpg", color: "Blue", variantId: 13, stock: 2, available: true };

const view = (props = {}, cartItems = {}) => {
  const store = { cartItems, addToCart: jest.fn(), removeFromCart: jest.fn(),
    isWishlisted: () => false, toggleWishlist: jest.fn() };
  render(<MemoryRouter><StoreContext.Provider value={store}><ProductCard {...base} {...props} /></StoreContext.Provider></MemoryRouter>);
  return store;
};

test("the add button names the colourway it commits, in the label and the accessible name", () => {
  const store = view();
  const add = screen.getByRole("button", { name: "Add Rayban in Blue to bag" });
  expect(add).toHaveTextContent("Add Blue to bag");
  fireEvent.click(add);
  expect(store.addToCart).toHaveBeenCalledWith("14", 13);
});

test("the quoted price belongs to the committed variant, not to the cheapest colour", () => {
  view();
  expect(screen.getByText("₹1,999")).toBeInTheDocument();
  expect(screen.getByText(/Other colours from ₹1,799/)).toBeInTheDocument();
});

test("the + button stops at the committed variant's stock", () => {
  const store = view({}, { "14:13": 2 });
  expect(screen.getByRole("button", { name: /No more Rayban in Blue available/i })).toBeDisabled();
  expect(store.addToCart).not.toHaveBeenCalled();
});

test("a colourway with no stock cannot be added even when the product flag says available", () => {
  view({ stock: 0 });
  expect(screen.getByRole("button", { name: "Rayban is out of stock" })).toBeDisabled();
});

// ── Hover reveal of the variant's first additional photo ──────────────────────────────────────
// The swap is CSS (opacity on :hover / :focus-within), which jsdom does not evaluate — so these
// assert the part that IS testable and that actually breaks: whether the second frame is in the
// DOM at all, whether it points at the additional photo, and whether it is hidden from assistive
// technology. Whether it visually cross-fades is measured in a real browser, not here.
test("a product whose variant has no additional photo renders a single frame", () => {
  view();
  const frames = document.querySelectorAll(".product-card-frame");
  expect(frames).toHaveLength(1);
  expect(frames[0]).toHaveAttribute("src", "/blue.jpg");
  // Without a second photo the container must not claim to have one, or CSS would reserve a
  // hover state that can never resolve to an image.
  expect(document.querySelector(".product-card-image")).not.toHaveClass("has-hover-frame");
});

test("the additional photo is rendered as a second frame over the first", () => {
  view({ hoverImage: "/blue-angle-2.jpg" });
  const frames = document.querySelectorAll(".product-card-frame");
  expect(frames).toHaveLength(2);
  expect(frames[0]).toHaveAttribute("src", "/blue.jpg");
  expect(frames[1]).toHaveAttribute("src", "/blue-angle-2.jpg");
  expect(document.querySelector(".product-card-image")).toHaveClass("has-hover-frame");
});

test("the hover frame is hidden from assistive technology and adds no second product name", () => {
  view({ hoverImage: "/blue-angle-2.jpg" });
  const hover = document.querySelector(".product-card-frame-hover");
  expect(hover).toHaveAttribute("aria-hidden", "true");
  expect(hover).toHaveAttribute("alt", "");
  // Exactly one accessible image for the product, whatever the frame count.
  expect(screen.getAllByRole("img")).toHaveLength(1);
  expect(screen.getByRole("img")).toHaveAccessibleName("Rayban");
});

test("both frames are in the DOM from the start, so hovering never waits on a download", () => {
  view({ hoverImage: "/blue-angle-2.jpg" });
  // The reveal must not be a src swap: if the hover photo only entered the DOM on pointerenter,
  // a cold cache would blank the card at the moment the shopper looked at it.
  expect(document.querySelectorAll(".product-card-image img")).toHaveLength(2);
});
