import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProductWizard from "./ProductWizard";

jest.mock("../../services/api", () => ({
  createProduct: jest.fn(),
  updateProduct: jest.fn(),
  setProductActive: jest.fn(),
  uploadProductImage: jest.fn(),
  deleteProductImage: jest.fn(),
  deleteProductVariant: jest.fn(),
  getProductById: jest.fn(),
  reorderProductImages: jest.fn(),
  setMainProductVariant: jest.fn(),
  setPrimaryProductImage: jest.fn(),
  setProductVariantActive: jest.fn(),
  updateProductImage: jest.fn(),
}));

const api = require("../../services/api");

const categories = [
  { categoryId: 1, categoryName: "Men" }, { categoryId: 2, categoryName: "Women" },
];

const renderWizard = (props = {}) => {
  const onClose = jest.fn();
  const onSaved = jest.fn();
  render(<ProductWizard product={null} categories={categories} accessToken="token"
    onClose={onClose} onSaved={onSaved} {...props} />);
  return { onClose, onSaved };
};

const fillStepOne = () => {
  fireEvent.change(screen.getByLabelText(/Product name/), { target: { value: "Aviator" } });
  fireEvent.click(screen.getByLabelText("Men"));
  fireEvent.change(screen.getByLabelText(/^Color/), { target: { value: "Black" } });
  fireEvent.change(screen.getByLabelText(/^SKU/), { target: { value: "AV-BLK" } });
  fireEvent.change(screen.getByLabelText(/^Price/), { target: { value: "1200" } });
  fireEvent.change(screen.getByLabelText(/^Stock/), { target: { value: "4" } });
};

const savedFamily = {
  productId: 7, productName: "Aviator", isActive: false, images: [],
  variants: [
    { variantId: 71, position: 1, mainVariant: true, sku: "AV-BLK" },
    { variantId: 72, position: 2, mainVariant: false, sku: "AV-BLU" },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  api.createProduct.mockResolvedValue(savedFamily);
  api.setProductActive.mockResolvedValue({ ...savedFamily, isActive: true });
  api.uploadProductImage.mockResolvedValue({ imageId: 1 });
});

test("step 1 explains the Main Product and refuses to continue with missing fields", () => {
  renderWizard();
  expect(screen.getByText(/The main product is Variant 1/)).toBeInTheDocument();
  expect(screen.getByText("Main product — Variant 1")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  // Still on step 1, with field-level messages rather than one generic banner.
  expect(screen.getByText("Give the product a name.")).toBeInTheDocument();
  expect(screen.getByText("A unique SKU is required.")).toBeInTheDocument();
  expect(screen.queryByText(/Does this product have more variants/)).toBeNull();
});

test("answering No keeps a single variant and publishing is draft-first on the wire", async () => {
  // The storefront half of the SPA caches its product list and refetches on this event; a publish
  // that does not announce itself leaves the home page showing the catalogue from before it.
  const catalogueChanged = jest.fn();
  window.addEventListener("shades:products-changed", catalogueChanged);
  const { onSaved } = renderWizard();
  fillStepOne();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByText(/2\. Does this product have more variants\?/)).toBeInTheDocument();
  // "No" is the default; no empty variant sections are shown.
  expect(screen.queryByText("Variant 2")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  expect(screen.getByText(/3\. Review and save/)).toBeInTheDocument();
  // Named twice by design: the summary line and the per-variant review row.
  expect(screen.getAllByText(/Black · SKU AV-BLK/).length).toBeGreaterThanOrEqual(1);
  fireEvent.click(screen.getByRole("button", { name: "Publish product" }));

  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  // Created as an inactive draft first, activated only after the uploads settled.
  expect(api.createProduct).toHaveBeenCalledWith("token", expect.objectContaining({
    productName: "Aviator", isActive: false,
    variants: [expect.objectContaining({ sku: "AV-BLK", price: 1200, quantityAvailable: 4 })],
  }));
  expect(api.setProductActive).toHaveBeenCalledWith("token", 7, true);
  expect(onSaved).toHaveBeenCalledWith(expect.stringContaining("published"));
  // Publishing must tell the storefront to refetch its list.
  expect(catalogueChanged).toHaveBeenCalled();
  window.removeEventListener("shades:products-changed", catalogueChanged);
});

test("Save as draft never activates the product nor disturbs the public catalogue", async () => {
  const catalogueChanged = jest.fn();
  window.addEventListener("shades:products-changed", catalogueChanged);
  const { onSaved } = renderWizard();
  fillStepOne();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.stringContaining("draft")));
  expect(api.setProductActive).not.toHaveBeenCalled();
  // A draft is not publicly visible, so there is nothing for the storefront to refetch.
  expect(catalogueChanged).not.toHaveBeenCalled();
  window.removeEventListener("shades:products-changed", catalogueChanged);
});

test("Yes reveals numbered variant sections and a duplicate SKU is blamed on the right one", async () => {
  renderWizard();
  fillStepOne();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByLabelText("Yes, add more variants"));
  fireEvent.click(screen.getByRole("button", { name: "+ Add variant" }));
  expect(screen.getByText("Variant 2")).toBeInTheDocument();

  const section = document.querySelector('[data-variant-section="2"]');
  fireEvent.change(section.querySelector('[id="pw-variants[1].color"]'), { target: { value: "Blue" } });
  fireEvent.change(section.querySelector('[id="pw-variants[1].sku"]'), { target: { value: "AV-BLK" } });
  fireEvent.change(section.querySelector('[id="pw-variants[1].price"]'), { target: { value: "1300" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByText("Variant 1 already uses this SKU.")).toBeInTheDocument();
  // The wizard stayed on step 2 rather than carrying the error forward.
  expect(screen.getByText(/2\. Does this product have more variants\?/)).toBeInTheDocument();
});

test("an unsaved additional variant can be removed before saving", () => {
  renderWizard();
  fillStepOne();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByLabelText("Yes, add more variants"));
  fireEvent.click(screen.getByRole("button", { name: "+ Add variant" }));
  expect(screen.getByText("Variant 2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(screen.queryByText("Variant 2")).toBeNull();
});

test("the main photo uploads first, marked as the variant's main image", async () => {
  const { onSaved } = renderWizard();
  fillStepOne();
  const mainFile = new File(["main"], "hero.png", { type: "image/png" });
  const extraFile = new File(["extra"], "detail.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Main photo for Black"), { target: { files: [mainFile] } });
  fireEvent.change(screen.getByLabelText("Additional photos for Black"), { target: { files: [extraFile] } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Publish product" }));

  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(api.uploadProductImage).toHaveBeenNthCalledWith(1, "token", 7, mainFile,
    expect.objectContaining({ variantId: 71, isPrimary: true, displayOrder: 0 }));
  expect(api.uploadProductImage).toHaveBeenNthCalledWith(2, "token", 7, extraFile,
    expect.objectContaining({ variantId: 71, isPrimary: false, displayOrder: 1 }));
});

test("a failed upload keeps the product a draft and says exactly what failed", async () => {
  api.uploadProductImage.mockRejectedValue(new Error("File too large"));
  const { onSaved } = renderWizard();
  fillStepOne();
  fireEvent.change(screen.getByLabelText("Main photo for Black"),
    { target: { files: [new File(["main"], "hero.png", { type: "image/png" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Publish product" }));

  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(api.setProductActive).not.toHaveBeenCalled();
  const message = onSaved.mock.calls[0][0];
  expect(message).toMatch(/draft/);
  expect(message).toMatch(/hero\.png: File too large/);
});

test("server field errors land on the right step and the right input", async () => {
  api.createProduct.mockRejectedValue(Object.assign(new Error("Validation Failed"), {
    validationErrors: { "variants[1].sku": "SKU already exists: AV-BLU" },
  }));
  renderWizard();
  fillStepOne();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByLabelText("Yes, add more variants"));
  fireEvent.click(screen.getByRole("button", { name: "+ Add variant" }));
  const section = document.querySelector('[data-variant-section="2"]');
  fireEvent.change(section.querySelector('[id="pw-variants[1].color"]'), { target: { value: "Blue" } });
  fireEvent.change(section.querySelector('[id="pw-variants[1].sku"]'), { target: { value: "AV-BLU" } });
  fireEvent.change(section.querySelector('[id="pw-variants[1].price"]'), { target: { value: "1300" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Publish product" }));

  // Bounced back to step 2 — where variants[1] lives — with the message on the field.
  await waitFor(() => expect(screen.getByText("SKU already exists: AV-BLU")).toBeInTheDocument());
  expect(screen.getByText(/2\. Does this product have more variants\?/)).toBeInTheDocument();
});

test("closing with unsaved changes asks through the application modal, not window.confirm", () => {
  const { onClose } = renderWizard();
  fireEvent.change(screen.getByLabelText(/Product name/), { target: { value: "Aviator" } });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(onClose).toHaveBeenCalled();
});

test("editing loads every saved variant and sends the full family with the loaded version", async () => {
  const product = {
    productId: 9, productName: "Wayfarer", brand: "Shades World", productDescription: "",
    version: 3, isActive: true,
    categories: [{ categoryId: 1, categoryName: "Men" }], attributes: {},
    images: [],
    variants: [
      { variantId: 91, position: 1, mainVariant: true, sku: "WF-1", variantName: "Black",
        price: 900, quantityAvailable: 2, lowStockThreshold: 1, isActive: true, attributes: { color: "Black" } },
      { variantId: 92, position: 2, mainVariant: false, sku: "WF-2", variantName: "Blue",
        price: 950, quantityAvailable: 0, lowStockThreshold: 1, isActive: true, attributes: { color: "Blue" } },
    ],
  };
  api.updateProduct.mockResolvedValue({ ...savedFamily, productId: 9, productName: "Wayfarer",
    variants: product.variants, images: [] });
  const { onSaved } = renderWizard({ product });

  expect(screen.getByText("Main product — Variant 1")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  // Both variants exist, so the "more variants" answer is already Yes and Variant 2 is shown.
  expect(screen.getByText("Variant 2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(api.updateProduct).toHaveBeenCalledWith("token", 9, expect.objectContaining({
    version: 3,
    variants: [
      expect.objectContaining({ variantId: 91, sku: "WF-1" }),
      expect.objectContaining({ variantId: 92, sku: "WF-2" }),
    ],
  }));
});

test("a stale-version conflict surfaces the server's refresh message instead of saving silently", async () => {
  const product = {
    productId: 9, productName: "Wayfarer", brand: "", productDescription: "", version: 3, isActive: true,
    categories: [{ categoryId: 1, categoryName: "Men" }], attributes: {}, images: [],
    variants: [{ variantId: 91, position: 1, mainVariant: true, sku: "WF-1", variantName: "Black",
      price: 900, quantityAvailable: 2, lowStockThreshold: 1, isActive: true, attributes: { color: "Black" } }],
  };
  api.updateProduct.mockRejectedValue(Object.assign(
    new Error("This information was updated elsewhere. Refresh and review the latest version before trying again."),
    { status: 409 }));
  renderWizard({ product });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText(/updated elsewhere/)).toBeInTheDocument();
});
