import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminStorefront from "./AdminStorefront";
import * as api from "../../services/api";

jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ accessToken: "token" }) }));
jest.mock("../../services/api", () => ({
  getCuratedBestSellers: jest.fn(),
  getStorefrontSettings: jest.fn(),
  getAdminProducts: jest.fn(),
  saveCuratedBestSellers: jest.fn(),
  uploadHeroImage: jest.fn(),
  resetHeroImage: jest.fn(),
}));

const product = (productId, productName) => ({ productId, productName, brand: "Sol", isActive: true });

const CATALOGUE = [product(1, "Alpha"), product(2, "Bravo"), product(3, "Charlie"), product(4, "Delta")];

const arrange = ({ curated = [], heroImageUrl = null } = {}) => {
  api.getCuratedBestSellers.mockResolvedValue({
    sourceIsCurated: curated.length > 0, curated, missingProductIds: [],
  });
  api.getStorefrontSettings.mockResolvedValue({ heroImageUrl });
  api.getAdminProducts.mockResolvedValue({ content: CATALOGUE });
  api.saveCuratedBestSellers.mockImplementation((token, productIds) => Promise.resolve({
    sourceIsCurated: productIds.length > 0,
    curated: productIds.map((id) => CATALOGUE.find((item) => item.productId === id)),
    missingProductIds: [],
  }));
  return render(<AdminStorefront />);
};

/** The rendered order, read from the list itself rather than from component state. */
const rowNames = () => [...document.querySelectorAll(".storefront-order li .storefront-item strong")]
  .map((node) => node.textContent);

beforeEach(() => jest.clearAllMocks());

test("an uncurated section says so and pins nothing", async () => {
  arrange();
  expect(await screen.findByText(/Not curated/i)).toBeInTheDocument();
  expect(rowNames()).toEqual([]);
});

test("the curated products render in the stored order, numbered as the shopper sees them", async () => {
  arrange({ curated: [product(3, "Charlie"), product(1, "Alpha")] });
  await waitFor(() => expect(rowNames()).toEqual(["Charlie", "Alpha"]));
  // The position badge is generated from the list index, so it must track the order, not the id.
  expect([...document.querySelectorAll(".storefront-position")].map((n) => n.textContent))
    .toEqual(["1", "2"]);
});

test("Move down reorders the list and Save persists exactly that sequence", async () => {
  arrange({ curated: [product(1, "Alpha"), product(2, "Bravo"), product(3, "Charlie")] });
  await waitFor(() => expect(rowNames()).toEqual(["Alpha", "Bravo", "Charlie"]));

  fireEvent.click(screen.getByLabelText("Move Alpha down to position 2"));
  expect(rowNames()).toEqual(["Bravo", "Alpha", "Charlie"]);

  fireEvent.click(screen.getByRole("button", { name: /^Save order$/ }));
  // The whole feature is that the admin's sequence is what gets stored — assert the exact argument.
  await waitFor(() => expect(api.saveCuratedBestSellers).toHaveBeenCalledWith("token", [2, 1, 3]));
});

test("Move up at the top and Move down at the bottom are disabled rather than silently doing nothing", async () => {
  arrange({ curated: [product(1, "Alpha"), product(2, "Bravo")] });
  await waitFor(() => expect(rowNames()).toEqual(["Alpha", "Bravo"]));
  expect(screen.getByLabelText("Move Alpha up to position 0")).toBeDisabled();
  expect(screen.getByLabelText("Move Bravo down to position 3")).toBeDisabled();
});

test("a product can be added from the picker and lands at the end", async () => {
  arrange({ curated: [product(2, "Bravo")] });
  await waitFor(() => expect(rowNames()).toEqual(["Bravo"]));

  fireEvent.change(screen.getByLabelText(/Add a product/i), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
  expect(rowNames()).toEqual(["Bravo", "Delta"]);

  fireEvent.click(screen.getByRole("button", { name: /^Save order$/ }));
  await waitFor(() => expect(api.saveCuratedBestSellers).toHaveBeenCalledWith("token", [2, 4]));
});

test("an already-pinned product is not offered again by the picker", async () => {
  arrange({ curated: [product(2, "Bravo")] });
  await waitFor(() => expect(rowNames()).toEqual(["Bravo"]));
  const options = [...screen.getByLabelText(/Add a product/i).querySelectorAll("option")]
    .map((option) => option.textContent);
  expect(options.some((label) => label.startsWith("Bravo"))).toBe(false);
  expect(options.some((label) => label.startsWith("Delta"))).toBe(true);
});

test("Remove drops the product and Save writes the shortened order", async () => {
  arrange({ curated: [product(1, "Alpha"), product(2, "Bravo")] });
  await waitFor(() => expect(rowNames()).toEqual(["Alpha", "Bravo"]));

  fireEvent.click(screen.getByLabelText("Remove Alpha from Best Sellers"));
  expect(rowNames()).toEqual(["Bravo"]);

  fireEvent.click(screen.getByRole("button", { name: /^Save order$/ }));
  await waitFor(() => expect(api.saveCuratedBestSellers).toHaveBeenCalledWith("token", [2]));
});

test("nothing is written until Save, so a half-arranged order never reaches the storefront", async () => {
  arrange({ curated: [product(1, "Alpha"), product(2, "Bravo")] });
  await waitFor(() => expect(rowNames()).toEqual(["Alpha", "Bravo"]));

  // Save is unreachable while the list matches the server: there is nothing to publish.
  expect(screen.getByRole("button", { name: /^Save order$/ })).toBeDisabled();

  fireEvent.click(screen.getByLabelText("Move Alpha down to position 2"));
  expect(screen.getByRole("button", { name: /^Save order$/ })).toBeEnabled();
  expect(screen.getByText(/Unsaved/i)).toBeInTheDocument();
  // Reordering alone must not have called the API.
  expect(api.saveCuratedBestSellers).not.toHaveBeenCalled();
});

test("clearing the curation hands the section back to the sales ranking", async () => {
  arrange({ curated: [product(1, "Alpha")] });
  await waitFor(() => expect(rowNames()).toEqual(["Alpha"]));

  fireEvent.click(screen.getByRole("button", { name: /Rank by sales instead/i }));
  await waitFor(() => expect(api.saveCuratedBestSellers).toHaveBeenCalledWith("token", []));
  expect(await screen.findByText(/back to ranking by sales/i)).toBeInTheDocument();
});

test("the hero panel shows the configured image, and offers a revert only when there is one", async () => {
  arrange({ heroImageUrl: "https://cdn.example/banner.jpg" });
  // waitFor only retries when its callback THROWS — returning null counts as success, so the
  // assertion has to be inside it or the wait is a no-op.
  await waitFor(() => expect(document.querySelector(".storefront-hero-preview img")).not.toBeNull());
  expect(document.querySelector(".storefront-hero-preview img"))
    .toHaveAttribute("src", "https://cdn.example/banner.jpg");
  expect(screen.getByRole("button", { name: /Revert to the built-in banner/i })).toBeInTheDocument();
});

test("with no configured image the panel says the built-in banner is in use and offers no revert", async () => {
  arrange({ heroImageUrl: "" });
  expect(await screen.findByText(/Using the built-in banner/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Revert/i })).not.toBeInTheDocument();
});

test("uploading an image sends the file and shows the returned URL", async () => {
  arrange({ heroImageUrl: null });
  await screen.findByText(/Using the built-in banner/i);
  api.uploadHeroImage.mockResolvedValue({ heroImageUrl: "https://cdn.example/new.png" });

  const file = new File(["binary"], "banner.png", { type: "image/png" });
  fireEvent.change(document.querySelector(".storefront-file input"), { target: { files: [file] } });

  await waitFor(() => expect(api.uploadHeroImage).toHaveBeenCalledWith("token", file));
  await waitFor(() => expect(document.querySelector(".storefront-hero-preview img"))
    .toHaveAttribute("src", "https://cdn.example/new.png"));
});
