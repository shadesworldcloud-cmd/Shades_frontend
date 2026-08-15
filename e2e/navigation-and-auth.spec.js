const { test, expect } = require("@playwright/test");
const { createProduct } = require("./support/fixtures");
const { signInAsNewCustomer, submitSignIn } = require("./support/ui");

let product;

test.beforeAll(async () => {
  product = await createProduct({
    name: `E2E Nav ${Date.now()}`,
    categoryName: "Women",
    variants: [
      { sku: `NAV-ROSE-${Date.now()}`, variantName: "Rose", color: "Rose", price: 900, quantityAvailable: 6 },
    ],
  });
});

test("Shop and Collections are reachable from the header, by direct URL, and across a refresh", async ({ page }) => {
  await page.goto("/");
  await page.locator(".navbar-menu a", { hasText: "Shop" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.getByRole("heading", { level: 1, name: "Shop" })).toBeVisible();

  await page.locator(".navbar-menu a", { hasText: "Collections" }).click();
  await expect(page).toHaveURL(/\/collections$/);
  await expect(page.getByRole("heading", { level: 1, name: "Collections" })).toBeVisible();
  await expect(page.locator(".collection-tile")).toHaveCount(4);

  // Direct URL then hard refresh: both must render, chrome included.
  await page.goto("/collections/women");
  await expect(page.getByRole("heading", { level: 1, name: "Women" })).toBeVisible();
  await expect(page.locator(".product-card", { hasText: product.name })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Women" })).toBeVisible();
  await expect(page.locator(".navbar")).toBeVisible();
  await expect(page.locator(".footer, footer")).toBeVisible();
});

test("opening a collection filters to it, and an unknown one says so rather than showing everything", async ({ page }) => {
  await page.goto("/collections/women");
  await expect(page.locator(".product-card", { hasText: product.name })).toBeVisible();

  await page.goto("/collections/polarized");
  await expect(page.getByRole("heading", { level: 1, name: "Collection not found" })).toBeVisible();
  await expect(page.locator(".product-card")).toHaveCount(0);
});

test("Shop keeps its category filter in the URL so it can be shared", async ({ page }) => {
  await page.goto("/shop?category=Men");
  await expect(page.locator(".product-card", { hasText: product.name })).toHaveCount(0);
  await page.goto("/shop?category=Women");
  await expect(page.locator(".product-card", { hasText: product.name })).toBeVisible();
});

test("a guest bag merges into the account on sign-in and survives refresh, logout and login", async ({ page }) => {
  await page.goto(`/product/${product.productId}`);
  await page.locator(".pd-add-btn").click();
  await page.locator(".pd-add-btn").click();
  await expect(page.locator(".cart-badge")).toHaveText("2");

  const account = await signInAsNewCustomer(page, "merge");

  // Merged into the account cart, and the guest copy is dropped so it cannot be re-merged.
  // The badge can read 2 from the optimistic projection before the merge settles, so the clear
  // is polled rather than sampled once — it happens after the last merge call resolves.
  await expect(page.locator(".cart-badge")).toHaveText("2", { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("shades_world_guest_cart")),
    { timeout: 20_000, message: "guest bag must be dropped once merged, or it re-merges on every reload" }
  ).toBeNull();

  // Authenticated persistence across a hard refresh comes from the database, not storage.
  await page.reload();
  await expect(page.locator(".cart-badge")).toHaveText("2", { timeout: 20_000 });

  await page.locator(".nav-account", { hasText: /sign out/i }).click();
  await expect(page.locator(".cart-badge")).toHaveCount(0);

  // Through the helper, not inlined. This is the account's SECOND sign-in, so it does not come
  // from signInAsNewCustomer and quietly kept its own copy of the form steps — without the
  // rate-limit backoff. Under a full suite it is the login that tips past 20/IP/min, and the
  // failure looks like "the bag did not come back" rather than "the login was throttled".
  await submitSignIn(page, account);
  // The bag comes back from the server, still 2.
  await expect(page.locator(".cart-badge")).toHaveText("2", { timeout: 20_000 });
});

test("signing out does not leak the account bag into the next guest session", async ({ page }) => {
  await signInAsNewCustomer(page, "leak");
  await page.goto(`/product/${product.productId}`);
  await page.locator(".pd-add-btn").click();
  await expect(page.locator(".cart-badge")).toHaveText("1");

  await page.locator(".nav-account", { hasText: /sign out/i }).click();
  await expect(page.locator(".cart-badge")).toHaveCount(0);
  const guestKey = await page.evaluate(() => window.localStorage.getItem("shades_world_guest_cart"));
  expect(guestKey).toBeNull();
});
