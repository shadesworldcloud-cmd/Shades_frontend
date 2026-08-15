const { test, expect } = require("@playwright/test");
const { createProduct, markDelivered, stockOf } = require("./support/fixtures");
const { addToBag, buyAndDeliver, checkout } = require("./support/shop");
const { sqlValue } = require("./support/api");
const { fillCheckoutAddress, signInAsNewCustomer } = require("./support/ui");

// The review flow end to end, against a genuinely DELIVERED order.
// This is the scenario the unapplied migration used to break: reviews are keyed per order item,
// but the live schema still enforced one review per user per product.

const approve = async (reviewId) => {
  const { admin } = require("./support/fixtures");
  const account = await admin();
  await account.client.patch(`/reviews/admin/${reviewId}/status`, { status: "APPROVED" });
};

test("an unauthenticated visitor is invited to sign in, not shown a dead form", async ({ page }) => {
  const product = await createProduct({
    name: `E2E Rev Guest ${Date.now()}`,
    variants: [{ sku: `RG-${Date.now()}`, variantName: "Slate", color: "Slate", price: 500, quantityAvailable: 2 }],
  });
  await page.goto(`/product/${product.productId}`);
  await expect(page.locator(".review-callout")).toContainText("Purchased this frame?");
  await expect(page.locator(".review-form")).toHaveCount(0);
});

test("a delivered purchase can be reviewed, and it persists across a refresh", async ({ page }) => {
  const product = await createProduct({
    name: `E2E Rev ${Date.now()}`,
    variants: [{ sku: `RV-${Date.now()}`, variantName: "Amber", color: "Amber", price: 750, quantityAvailable: 3 }],
  });
  await signInAsNewCustomer(page, "review");
  await buyAndDeliver(page, { productId: product.productId, colour: "Amber" });

  await page.goto(`/product/${product.productId}`);
  await expect(page.locator(".review-form")).toBeVisible({ timeout: 20_000 });
  await page.locator(".review-stars.interactive button").nth(3).click(); // 4 stars
  await page.locator(".review-form textarea").fill("Crisp amber lenses, very light.");
  await page.locator(".review-form button[type=submit], .review-form-footer button:not(.cancel)").last().click();

  // Published on submission: eligibility is the gate, not a moderator.
  await expect(page.locator(".reviews-alert.success")).toContainText("live", { timeout: 20_000 });
  await expect(page.locator(".my-review")).toContainText("PUBLISHED");

  // It is in the database, and it survives a reload.
  const reviewId = Number(sqlValue("SELECT MAX(REVIEW_ID) FROM REVIEWS"));
  expect(sqlValue(`SELECT RATING FROM REVIEWS WHERE REVIEW_ID=${reviewId}`)).toBe("4");
  expect(sqlValue(`SELECT REVIEW_TEXT FROM REVIEWS WHERE REVIEW_ID=${reviewId}`))
    .toContain("Crisp amber lenses");
  await page.reload();
  await expect(page.locator(".my-review")).toContainText("PUBLISHED", { timeout: 20_000 });

  // Once approved it counts towards the public rating summary.
  await approve(reviewId);
  await page.reload();
  await expect(page.locator(".reviews-score strong")).toHaveText("4.0", { timeout: 20_000 });
  await expect(page.locator(".reviews-list article")).toContainText("Crisp amber lenses");
});

test("both variants of one product can be reviewed — the case the DB constraint blocked", async ({ page }) => {
  const stamp = Date.now();
  const product = await createProduct({
    name: `E2E Rev Two ${stamp}`,
    variants: [
      { sku: `R2A-${stamp}`, variantName: "Ocean", color: "Blue", price: 800, quantityAvailable: 3 },
      { sku: `R2B-${stamp}`, variantName: "Night", color: "Black", price: 800, quantityAvailable: 3 },
    ],
  });
  const account = await signInAsNewCustomer(page, "reviewtwo");

  // One order containing both variants, delivered. Two separate adds, each waited on by the
  // shared helper, then a single checkout.
  await addToBag(page, { productId: product.productId, colour: "Blue", expectedBadge: 1 });
  await addToBag(page, { productId: product.productId, colour: "Black", expectedBadge: 2 });
  const orderId = await checkout(page);
  expect(await markDelivered(orderId)).toBe("DELIVERED");

  // Review the first variant, then the second. Under the old UQ_USER_PRODUCT_REVIEW index the
  // second insert violated a unique constraint on (USER_ID, PRODUCT_ID).
  const items = await account.client.get(`/reviews/products/${product.productId}/reviewable-variants`);
  expect(items).toHaveLength(2);
  for (const item of items) {
    await account.client.post("/reviews", {
      productId: product.productId, orderItemId: item.orderItemId,
      rating: 5, reviewText: `Great ${item.variantName}.`,
    });
  }
  expect(Number(sqlValue(`SELECT COUNT(*) FROM REVIEWS WHERE USER_ID=${account.userId}
      AND PRODUCT_ID=${product.productId}`))).toBe(2);

  // A third review of the same order item is still refused — per-item uniqueness holds.
  await expect(account.client.post("/reviews", {
    productId: product.productId, orderItemId: items[0].orderItemId, rating: 3, reviewText: "Again.",
  })).rejects.toThrow(/already reviewed/i);
});

test("an out-of-range rating and an unpurchased variant are both refused", async ({ page }) => {
  const product = await createProduct({
    name: `E2E Rev Guard ${Date.now()}`,
    variants: [{ sku: `RGD-${Date.now()}`, variantName: "Ivory", color: "Ivory", price: 400, quantityAvailable: 2 }],
  });
  const account = await signInAsNewCustomer(page, "reviewguard");

  // Never purchased: the server must refuse regardless of what the client sends.
  await expect(account.client.post("/reviews", {
    productId: product.productId, orderItemId: 999999, rating: 5, reviewText: "Nice",
  })).rejects.toThrow();

  await buyAndDeliver(page, { productId: product.productId, colour: "Ivory" });
  const [item] = await account.client.get(`/reviews/products/${product.productId}/reviewable-variants`);

  for (const rating of [0, 6, -1]) {
    await expect(account.client.post("/reviews", {
      productId: product.productId, orderItemId: item.orderItemId, rating, reviewText: "Out of range",
    })).rejects.toThrow();
  }
  expect(Number(sqlValue(`SELECT COUNT(*) FROM REVIEWS WHERE USER_ID=${account.userId}`))).toBe(0);
});

test("review text is escaped, never rendered as markup", async ({ page }) => {
  const product = await createProduct({
    name: `E2E Rev XSS ${Date.now()}`,
    variants: [{ sku: `RX-${Date.now()}`, variantName: "Onyx", color: "Onyx", price: 650, quantityAvailable: 2 }],
  });
  const account = await signInAsNewCustomer(page, "reviewxss");
  await buyAndDeliver(page, { productId: product.productId, colour: "Onyx" });
  const [item] = await account.client.get(`/reviews/products/${product.productId}/reviewable-variants`);
  const created = await account.client.post("/reviews", {
    productId: product.productId, orderItemId: item.orderItemId, rating: 5,
    reviewText: '<img src=x onerror="window.__xss=1">payload',
  });
  await approve(created.reviewId);

  let alertFired = false;
  page.on("dialog", async (dialog) => { alertFired = true; await dialog.dismiss(); });
  await page.goto(`/product/${product.productId}`);
  await expect(page.locator(".reviews-list article")).toContainText("payload", { timeout: 20_000 });
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator(".reviews-list img[onerror]").count()).toBe(0);
  expect(alertFired).toBe(false);
  // Stock is untouched by reviewing.
  expect(stockOf(item.variantId)).toBe(1);
});
