import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ProductGrid from "./ProductGrid";
import { StoreContext } from "../../context/StoreContext";

jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

const products = [
  { _id: "1", productId: 1, name: "Barcelona Ocean", brand: "Sol", description: "Light frame", price: 1200,
    image: "/ocean.jpg", color: "Blue", isNew: true, available: true, defaultVariantId: 11,
    categories: [{ categoryName: "Unisex" }], variants: [{ variantId: 11, variantName: "Ocean", sku: "BAR-BLU", attributes: { color: "Blue" } }] },
  { _id: "2", productId: 2, name: "Madrid Rose", brand: "Luna", description: "Rose frame", price: 1800,
    image: "/rose.jpg", color: "Rose", isNew: false, available: false, defaultVariantId: 22,
    categories: [{ categoryName: "Women" }], variants: [{ variantId: 22, variantName: "Rose", sku: "MAD-ROS", attributes: { color: "Rose" } }] },
];
const store = { product_list: products, productsLoading: false, productsError: "", cartItems: {},
  addToCart: jest.fn(), removeFromCart: jest.fn(), isWishlisted: () => false, toggleWishlist: jest.fn() };
const view = (url = "/") => render(<MemoryRouter initialEntries={[url]}><StoreContext.Provider value={store}><ProductGrid category="All" /></StoreContext.Provider></MemoryRouter>);

test("matches every normalized search term across product and variant fields", () => {
  view("/?q=blue%20barcelona");
  expect(screen.getByText("Barcelona Ocean")).toBeInTheDocument();
  expect(screen.queryByText("Madrid Rose")).not.toBeInTheDocument();
  expect(screen.getByText("1 style")).toBeInTheDocument();
});

test("prevents adding a fully out-of-stock catalogue item", () => {
  view();
  expect(screen.getByRole("button", { name: /Madrid Rose is out of stock/i })).toBeDisabled();
});

test("explains an inverted price range instead of silently returning nothing", () => {
  view("/?minPrice=2000&maxPrice=1000");
  expect(screen.getByRole("alert")).toHaveTextContent("Minimum price cannot exceed maximum price");
  expect(screen.getByText("Correct the price range to continue.")).toBeInTheDocument();
});

test("the listing card names the colourway its button will add", () => {
  view();
  expect(screen.getByRole("button", { name: "Add Barcelona Ocean in Blue to bag" })).toBeInTheDocument();
});

// A product's `price` is its lowest ACTIVE variant, which may be a colourway that is out of stock
// and therefore not the one the card commits or quotes. Sorting on it produced a "Price: low to
// high" grid whose printed prices descended. Girona is the case: cheapest colourway ₹900 sold out,
// so the card quotes ₹2,400 and must sort above the ₹1,500 product.
const mixedStock = [
  { ...products[0], _id: "3", productId: 3, name: "Girona Amber", price: 900, defaultVariantPrice: 2400, priceFrom: 900 },
  { ...products[0], _id: "4", productId: 4, name: "Sitges Slate", price: 1500, defaultVariantPrice: 1500, priceFrom: null },
];
const viewMixed = (url) => render(
  <MemoryRouter initialEntries={[url]}>
    <StoreContext.Provider value={{ ...store, product_list: mixedStock }}><ProductGrid category="All" /></StoreContext.Provider>
  </MemoryRouter>
);
const printed = (container, selector) => [...container.querySelectorAll(selector)].map((node) => node.textContent);

test("sorts by the price each card prints, not by an out-of-stock minimum", () => {
  const { container } = viewMixed("/?sort=price-low");
  expect(printed(container, ".product-name")).toEqual(["Sitges Slate", "Girona Amber"]);
  expect(printed(container, ".product-price")).toEqual(["₹1,500", "₹2,400"]);
});

test("reverses that same order for high to low", () => {
  const { container } = viewMixed("/?sort=price-high");
  expect(printed(container, ".product-name")).toEqual(["Girona Amber", "Sitges Slate"]);
  expect(printed(container, ".product-price")).toEqual(["₹2,400", "₹1,500"]);
});
