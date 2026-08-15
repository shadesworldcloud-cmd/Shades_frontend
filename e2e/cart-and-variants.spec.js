const { test, expect } = require("@playwright/test");
const { createProduct } = require("./support/fixtures");

// Guest cart persistence, variant-specific content, the header, and the removed counters.
// Real frontend, real backend, real MySQL — nothing stubbed.

let product;

test.beforeAll(async () => {
  product = await createProduct({
    name: `E2E Cart ${Date.now()}`,
    variants: [
      { sku: `CART-BLUE-${Date.now()}`, variantName: "Ocean Blue", color: "Blue", price: 1200,
        quantityAvailable: 4, lowStockThreshold: 1, variantDescription: "Ocean Blue: mirrored, for bright days." },
      { sku: `CART-BLACK-${Date.now()}`, variantName: "Midnight", color: "Black", price: 1400,
        quantityAvailable: 2, lowStockThreshold: 5 },
    ],
  });
});

const productPage = (page) => page.goto(`/product/${product.productId}`);
const tile = (page, colour) => page.locator(".pd-variant-options button", { hasText: colour });
const openTab = (page, name) => page.locator(".pd-tabs button", { hasText: name }).click();

test("a guest bag with two variants and quantities survives a hard refresh", async ({ page }) => {
  await productPage(page);
  await tile(page, "Blue").click();
  await page.locator(".pd-add-btn").click();
  await page.locator(".pd-add-btn").click();
  await tile(page, "Black").click();
  await page.locator(".pd-add-btn").click();
  await expect(page.locator(".cart-badge")).toHaveText("3");

  await page.reload();

  await expect(page.locator(".cart-badge")).toHaveText("3");
  await page.goto("/cart");
  const rows = page.locator(".cart-item");
  await expect(rows).toHaveCount(2);
  await expect(page.locator(".cart-summary-row", { hasText: "Items" })).toContainText("3 units");
  // Quantities, variants and prices all restored correctly, re-derived from the live catalogue.
  // The bag labels a line by its colour (the shared variantLabel), not by the internal variantName.
  await expect(rows.filter({ hasText: "Blue" })).toContainText("₹1,200");
  await expect(rows.filter({ hasText: "Black" })).toContainText("₹1,400");
  await expect(page.locator(".cart-summary-row", { hasText: "Subtotal" })).toContainText("3,800");
});

test("an emptied guest bag stays empty after a refresh", async ({ page }) => {
  await productPage(page);
  await tile(page, "Blue").click();
  await page.locator(".pd-add-btn").click();
  await page.goto("/cart");
  await page.locator(".cart-item-remove").first().click();
  await expect(page.locator(".cart-empty")).toBeVisible();

  await page.reload();
  await expect(page.locator(".cart-empty")).toBeVisible();
  await expect(page.locator(".cart-badge")).toHaveCount(0);
});

test("Description, Details, Shipping, price and stock all follow the selected variant", async ({ page }) => {
  await productPage(page);

  await tile(page, "Blue").click();
  await expect(page.locator(".pd-price")).toHaveText("₹1,200");
  await expect(page.locator(".pd-stock")).toContainText("4 in stock");
  await expect(page.locator(".pd-tab-content")).toContainText("Ocean Blue: mirrored, for bright days.");
  await openTab(page, "Details");
  await expect(page.locator(".pd-tab-content")).toContainText("colourway: Ocean Blue");
  await expect(page.locator(".pd-tab-content")).toContainText("color: Blue");
  await openTab(page, "Shipping");
  await expect(page.locator(".pd-tab-content")).toContainText("Blue is in stock");

  await tile(page, "Black").click();
  await expect(page.locator(".pd-price")).toHaveText("₹1,400");
  await expect(page.locator(".pd-stock")).toContainText("2 in stock");
  // lowStockThreshold 5 with stock 2 => the low-stock wording, derived from this variant's numbers.
  await expect(page.locator(".pd-tab-content")).toContainText("Only 2 left in Black");
  await openTab(page, "Details");
  await expect(page.locator(".pd-tab-content")).toContainText("colourway: Midnight");
  await expect(page.locator(".pd-tab-content")).toContainText("color: Black");
  await expect(page.locator(".pd-tab-content")).not.toContainText("color: Blue");
  await openTab(page, "Description");
  // Midnight has no copy of its own, so it inherits and says so.
  await expect(page.locator(".pd-tab-content")).toContainText("shared product copy");
  await expect(page.locator(".pd-tab-content")).toContainText("covers every colourway");
});

test("the variant added to the bag is the one that was selected", async ({ page }) => {
  await productPage(page);
  await tile(page, "Black").click();
  await expect(page.locator(".pd-add-btn")).toContainText("Add Black to bag");
  await page.locator(".pd-add-btn").click();

  await page.goto("/cart");
  await expect(page.locator(".cart-item")).toHaveCount(1);
  await expect(page.locator(".cart-item")).toContainText("Black");
  await expect(page.locator(".cart-item")).not.toContainText("Blue");
});

test("the header has no search icon at desktop and mobile widths", async ({ page }) => {
  await page.goto("/");
  for (const size of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(size);
    await expect(page.locator('img[alt="Search"]')).toHaveCount(0);
    await expect(page.locator(".navbar-right")).toBeVisible();
    // Layout intact: nothing overflows the viewport horizontally.
    const scrolls = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    expect(scrolls, `no horizontal overflow at ${size.width}px`).toBe(false);
  }
});

test("no quantity counter appears after adding, on the listing or the product page", async ({ page }) => {
  await page.goto("/shop");
  const card = page.locator(".product-card", { hasText: product.name });
  await card.locator(".add-to-bag").click();
  await expect(card.locator(".qty-control")).toHaveCount(0);
  await expect(card.locator(".product-card-in-bag")).toContainText("1 in bag");

  await productPage(page);
  await expect(page.locator(".pd-qty-row")).toHaveCount(0);
  await expect(page.locator(".pd-qty-control")).toHaveCount(0);
  // Add-to-cart still works and the bag is still reachable.
  await expect(page.locator(".pd-view-cart")).toBeVisible();
  await expect(page.locator(".cart-badge")).toHaveText("1");
});

test("the add button holds the per-variant stock ceiling", async ({ page }) => {
  await productPage(page);
  await tile(page, "Black").click(); // stock 2
  const add = page.locator(".pd-add-btn");
  await add.click();
  await add.click();
  await expect(add).toContainText("All 2 in your bag");
  await expect(add).toBeDisabled();
  await expect(page.locator(".cart-badge")).toHaveText("2");
});
