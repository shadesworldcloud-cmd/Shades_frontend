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
