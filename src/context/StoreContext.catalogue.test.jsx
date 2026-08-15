import { render, screen, waitFor } from "@testing-library/react";
import { useContext } from "react";
import StoreContextProvider, { StoreContext, resolveCartLines, variantLabel } from "./StoreContext";
import * as api from "../services/api";

const mockAuth = { accessToken: null, user: null, isAdmin: false };
jest.mock("./AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../services/api", () => ({ getStoreProducts: jest.fn(), getCart: jest.fn(), updateCartItem: jest.fn(),
  addCartItem: jest.fn(), removeCartItem: jest.fn(), getWishlist: jest.fn(), addWishlistItem: jest.fn(), removeWishlistItem: jest.fn(),
  quoteCart: jest.fn() }));

// The cheapest active variant (Blue, 2499) is out of stock, so the variant the card will
// commit is Pink at 2999. Non-uniform prices on purpose: the seed data is uniform today.
const payload = { content: [{ productId: 14, productName: "Rayban", basePrice: 1999, isActive: true,
  categories: [{ categoryId: 3, categoryName: "Unisex" }],
  variants: [
    { variantId: 13, sku: "SUL-001-BLUE", variantName: "Ocean Blue", price: 2499, quantityAvailable: 0, isActive: true, attributes: { color: "Blue" } },
    { variantId: 14, sku: "SKU-002-PINK", variantName: "Ocean Pink", price: 2999, quantityAvailable: 7, isActive: true, attributes: { color: "Pink" } },
  ],
  images: [{ imageId: 3, imageUrl: "/product.jpg", altText: "Rayban", isPrimary: true, variantId: null },
    { imageId: 5, imageUrl: "/pink.jpg", altText: "Rayban Pink", isPrimary: false, variantId: 14 }],
  attributes: {} }] };

function Harness() {
  const store = useContext(StoreContext);
  const product = store.product_list[0];
  if (!product) return <output aria-label="mapped">none</output>;
  return <output aria-label="mapped">{[product.defaultVariantId, product.defaultVariantPrice, product.priceFrom,
    product.defaultVariantImage, product.color, product.price, product.defaultVariantStock].join("|")}</output>;
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockAuth, { accessToken: null, user: null, isAdmin: false });
  api.getStoreProducts.mockResolvedValue(payload);
  api.getWishlist.mockResolvedValue({ items: [] });
  api.quoteCart.mockResolvedValue(null);
});

test("the listing fields describe the variant the card commits, not the cheapest one", async () => {
  render(<StoreContextProvider><Harness /></StoreContextProvider>);
  // defaultVariant is Pink (in stock): its own price, its own photo, its own colour name
  // and its own stock. price stays 2499 because discovery sorts and filters compare
  // products, and priceFrom exposes that gap instead of hiding it.
  await waitFor(() => expect(screen.getByLabelText("mapped"))
    .toHaveTextContent("14|2999|2499|/pink.jpg|Pink|2499|7"));
});

test("variantLabel falls back through colour, then variant name, then SKU", () => {
  expect(variantLabel({ attributes: { color: "Blue" }, variantName: "Ocean Blue", sku: "S1" })).toBe("Blue");
  expect(variantLabel({ attributes: {}, variantName: "Ocean Blue", sku: "S1" })).toBe("Ocean Blue");
  expect(variantLabel({ attributes: {}, variantName: null, sku: "S1" })).toBe("S1");
  expect(variantLabel(undefined)).toBe("");
});

test("resolveCartLines keeps an unresolvable line so no cart surface can disagree with another", () => {
  const products = [{ _id: "14", name: "Rayban", price: 1999, image: "/p.jpg", color: "Blue", images: [],
    variants: [{ variantId: 13, sku: "S", price: 1999, quantityAvailable: 4, attributes: { color: "Blue" } }] }];
  const lines = resolveCartLines({ "14:13": 2, "14:99": 1, "77:5": 3 }, products);
  expect(lines).toHaveLength(3);
  expect(lines.map((line) => line.resolved)).toEqual([true, false, false]);
  expect(lines.reduce((sum, line) => sum + line.quantity, 0)).toBe(6);
  // The parsed variantId is what a degraded row's Remove needs.
  expect(lines[1].variantId).toBe(99);
  expect(lines[1].title).toBe("Rayban");
  expect(lines[1].price).toBeNull();
  expect(lines[2].title).toBe("Unavailable item");
  // Known stock stays a number; a missing variant is unknown, not unlimited.
  expect(lines[0].quantityAvailable).toBe(4);
  expect(lines[1].quantityAvailable).toBeNull();
});
