import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Shop from "./Shop";
import Collections from "../Collections/Collections";
import { StoreContext } from "../../context/StoreContext";

jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

const product = (id, name, categoryName, price = 1000) => ({
  _id: String(id), productId: id, name, brand: "Sol", description: "", price,
  image: `/p${id}.jpg`, images: [], color: "Blue", isNew: false, available: true,
  defaultVariantId: id * 10, defaultVariantPrice: price, defaultVariantStock: 5, priceFrom: null,
  categories: [{ categoryName }], category: categoryName, attributes: {},
  variants: [{ variantId: id * 10, variantName: "Blue", sku: `SKU${id}`, price, quantityAvailable: 5, attributes: { color: "Blue" } }],
});

const store = (overrides = {}) => ({
  product_list: [], productsLoading: false, productsError: "", refreshProducts: jest.fn(),
  categories: ["All", "Men", "Women", "Unisex", "Accessory"], cartItems: {},
  addToCart: jest.fn(), removeFromCart: jest.fn(), isWishlisted: () => false, toggleWishlist: jest.fn(),
  ...overrides,
});

const viewShop = (value, url = "/shop") => render(
  <MemoryRouter initialEntries={[url]}><StoreContext.Provider value={value}>
    <Routes><Route path="/shop" element={<Shop />} /></Routes>
  </StoreContext.Provider></MemoryRouter>
);
const viewCollections = (value, url = "/collections") => render(
  <MemoryRouter initialEntries={[url]}><StoreContext.Provider value={value}>
    <Routes>
      <Route path="/collections" element={<Collections />} />
      <Route path="/collections/:collection" element={<Collections />} />
    </Routes>
  </StoreContext.Provider></MemoryRouter>
);

describe("Shop", () => {
  test("renders the catalogue with the shared discovery controls", () => {
    viewShop(store({ product_list: [product(1, "Ocean", "Men"), product(2, "Rose", "Women")] }));
    expect(screen.getByRole("heading", { level: 1, name: "Shop" })).toBeInTheDocument();
    expect(screen.getByText("Ocean")).toBeInTheDocument();
    expect(screen.getByLabelText("Search products")).toBeInTheDocument();
    expect(screen.getByLabelText("Sort products")).toBeInTheDocument();
  });

  test("a category in the URL filters the grid, so a filtered shop can be shared", () => {
    viewShop(store({ product_list: [product(1, "Ocean", "Men"), product(2, "Rose", "Women")] }), "/shop?category=Women");
    expect(screen.getByText("Rose")).toBeInTheDocument();
    expect(screen.queryByText("Ocean")).not.toBeInTheDocument();
  });

  test("an unknown category falls back to All rather than showing nothing", () => {
    viewShop(store({ product_list: [product(1, "Ocean", "Men")] }), "/shop?category=Polarized");
    expect(screen.getByText("Ocean")).toBeInTheDocument();
  });

  test("shows a loading state", () => {
    viewShop(store({ productsLoading: true }));
    expect(screen.getByText("Loading the collection…")).toBeInTheDocument();
  });

  test("shows an error state with a retry that refetches", () => {
    const refreshProducts = jest.fn();
    const { container } = viewShop(store({ productsError: "boom", refreshProducts }));
    // One error message, not two: the shared grid owns it so Home gets the retry as well.
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("The collection could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refreshProducts).toHaveBeenCalled();
  });

  test("shows an empty state when the catalogue has nothing in it", () => {
    viewShop(store({ product_list: [] }));
    expect(screen.getByText(/No products are available just yet/)).toBeInTheDocument();
  });
});

describe("Shop pagination", () => {
  // 27 products => 3 pages of 12/12/3. Assertions use card counts and the current-page marker
  // rather than product names, because the default "featured" sort orders by productId
  // descending and would make name-based expectations depend on sort order.
  const many = Array.from({ length: 27 }, (unused, index) => product(index + 1, `Frame ${index + 1}`, "Men"));
  const cardCount = (container) => container.querySelectorAll(".product-card").length;
  const names = (container) => [...container.querySelectorAll(".product-name")].map((node) => node.textContent);

  test("does not render a control for a single page", () => {
    viewShop(store({ product_list: many.slice(0, 5) }));
    expect(screen.queryByRole("navigation", { name: "Product pages" })).not.toBeInTheDocument();
  });

  test("splits a long catalogue into pages of twelve and moves between them", () => {
    const { container } = viewShop(store({ product_list: many }));
    expect(cardCount(container)).toBe(12);
    const firstPage = names(container);

    fireEvent.click(screen.getByRole("button", { name: "Page 2 of 3" }));
    expect(cardCount(container)).toBe(12);
    const secondPage = names(container);
    expect(secondPage).not.toEqual(firstPage);
    expect(secondPage.some((name) => firstPage.includes(name))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Page 3 of 3" }));
    expect(cardCount(container)).toBe(3);
  });

  test("an out-of-range page clamps to the last page instead of an empty grid", () => {
    const { container } = viewShop(store({ product_list: many }), "/shop?page=99");
    expect(cardCount(container)).toBe(3);
    expect(screen.getByRole("button", { name: "Page 3 of 3" })).toHaveAttribute("aria-current", "page");
  });

  test("junk in the page param falls back to page one", () => {
    const { container } = viewShop(store({ product_list: many }), "/shop?page=abc");
    expect(cardCount(container)).toBe(12);
    expect(screen.getByRole("button", { name: "Page 1 of 3" })).toHaveAttribute("aria-current", "page");
  });

  test("changing a filter drops the page, so the shopper is never stranded past the end", () => {
    const { container } = viewShop(store({ product_list: many }), "/shop?page=3");
    expect(cardCount(container)).toBe(3);
    // "Frame 2" matches Frame 2, 20-27 — nine results, one page. Page 3 no longer exists.
    fireEvent.change(screen.getByLabelText("Search products"), { target: { value: "Frame 2" } });
    expect(cardCount(container)).toBeGreaterThan(0);
    expect(screen.queryByRole("navigation", { name: "Product pages" })).not.toBeInTheDocument();
  });

  test("previous and next are disabled at the ends", () => {
    viewShop(store({ product_list: many }));
    expect(screen.getByRole("button", { name: "← Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next →" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Page 3 of 3" }));
    expect(screen.getByRole("button", { name: "Next →" })).toBeDisabled();
  });
});

describe("Collections", () => {
  test("lists the real collections with counts", () => {
    viewCollections(store({ product_list: [product(1, "Ocean", "Men"), product(2, "Rose", "Women"), product(3, "Sky", "Women")] }));
    expect(screen.getByRole("heading", { level: 1, name: "Collections" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Men" })).toBeInTheDocument();
    expect(screen.getByText("1 style")).toBeInTheDocument();
    expect(screen.getByText("2 styles")).toBeInTheDocument();
    // Unisex and Accessory are both empty in this fixture.
    expect(screen.getAllByText("Nothing here yet")).toHaveLength(2);
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href")))
      .toEqual(expect.arrayContaining(["/collections/men", "/collections/women", "/collections/unisex", "/collections/accessory"]));
  });

  test("opening a collection shows only that collection's products", () => {
    viewCollections(store({ product_list: [product(1, "Ocean", "Men"), product(2, "Rose", "Women")] }), "/collections/women");
    expect(screen.getByRole("heading", { level: 1, name: "Women" })).toBeInTheDocument();
    expect(screen.getByText("Rose")).toBeInTheDocument();
    expect(screen.queryByText("Ocean")).not.toBeInTheDocument();
  });

  test("an unknown collection says so instead of silently showing everything", () => {
    // The old Home cards linked to "Polarized", which does not exist, and quietly showed all.
    viewCollections(store({ product_list: [product(1, "Ocean", "Men")] }), "/collections/polarized");
    expect(screen.getByRole("heading", { level: 1, name: "Collection not found" })).toBeInTheDocument();
    expect(screen.queryByText("Ocean")).not.toBeInTheDocument();
  });

  test("shows loading and error states", () => {
    const { unmount } = viewCollections(store({ productsLoading: true }));
    expect(screen.getByText("Loading collections…")).toBeInTheDocument();
    unmount();

    const refreshProducts = jest.fn();
    viewCollections(store({ productsError: "boom", refreshProducts }));
    expect(screen.getByRole("alert")).toHaveTextContent("Collections could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refreshProducts).toHaveBeenCalled();
  });
});
