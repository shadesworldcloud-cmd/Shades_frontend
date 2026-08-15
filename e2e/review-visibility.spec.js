const { test, expect } = require("@playwright/test");
const { admin, createProduct, markDelivered } = require("./support/fixtures");
const { buyAndDeliver } = require("./support/shop");
const { createCustomer, sqlValue } = require("./support/api");
const { fillCheckoutAddress, signInAsNewCustomer, submitSignIn } = require("./support/ui");

// Issue 1: a review from an eligible customer is published immediately — no admin approval.
// Real frontend, real backend, real MySQL.

const newProduct = (label) => createProduct({
  name: `E2E Vis ${label} ${Date.now()}`,
  variants: [{ sku: `VIS-${label}-${Date.now()}`, variantName: "Slate", color: "Slate", price: 900, quantityAvailable: 6 }],
});

test("a review is live immediately, survives a hard refresh, and is visible to guests and other customers", async ({ page, browser }) => {
  const product = await newProduct("A");
  await signInAsNewCustomer(page, "visA");
  await buyAndDeliver(page, { productId: product.productId, colour: "Slate" });

  await page.goto(`/product/${product.productId}`);
  await expect(page.locator(".review-form")).toBeVisible({ timeout: 20_000 });
  await page.locator(".review-stars.interactive button").nth(4).click(); // 5 stars
  await page.locator(".review-form textarea").fill("Published without waiting for anyone.");
  await page.locator(".review-form-footer button:not(.cancel)").last().click();

  // Live, not "sent for moderation".
  await expect(page.locator(".reviews-alert.success")).toContainText("live", { timeout: 20_000 });
  await expect(page.locator(".reviews-list article")).toContainText("Published without waiting for anyone.");
  const reviewId = Number(sqlValue("SELECT MAX(REVIEW_ID) FROM REVIEWS"));
  expect(sqlValue(`SELECT REVIEW_STATUS FROM REVIEWS WHERE REVIEW_ID=${reviewId}`)).toBe("PUBLISHED");

  // Survives a hard refresh for the author.
  await page.reload();
  await expect(page.locator(".reviews-list article")).toContainText("Published without waiting for anyone.", { timeout: 20_000 });
  await expect(page.locator(".reviews-score strong")).toHaveText("5.0");

  // Visible to a signed-out guest.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(`/product/${product.productId}`);
  await expect(guest.locator(".reviews-list article")).toContainText("Published without waiting for anyone.", { timeout: 20_000 });
  await expect(guest.locator(".reviews-score strong")).toHaveText("5.0");
  await expect(guest.locator(".review-callout")).toContainText("Purchased this frame?");
  await guestContext.close();

  // Visible to a different signed-in customer.
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signInAsNewCustomer(other, "visB");
  await other.goto(`/product/${product.productId}`);
  await expect(other.locator(".reviews-list article")).toContainText("Published without waiting for anyone.", { timeout: 20_000 });
  await expect(other.locator(".reviews-score strong")).toHaveText("5.0");
  await otherContext.close();
});

test("the count and average update as reviews are added", async ({ page, browser }) => {
  const product = await newProduct("Avg");
  const first = await signInAsNewCustomer(page, "avg1");
  await buyAndDeliver(page, { productId: product.productId, colour: "Slate" });
  const [itemOne] = await first.client.get(`/reviews/products/${product.productId}/reviewable-variants`);
  await first.client.post("/reviews", { productId: product.productId, orderItemId: itemOne.orderItemId, rating: 5, reviewText: "Five." });

  await page.goto(`/product/${product.productId}`);
  await expect(page.locator(".reviews-score strong")).toHaveText("5.0", { timeout: 20_000 });
  await expect(page.locator(".reviews-heading")).toContainText("1 verified review");

  // A second customer's review moves the average with no moderation step in between.
  const second = await createCustomer("avg2");
  // A separate context: reusing this one would still be signed in as the first customer, and
  // /signin would redirect away before the form could be filled.
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await submitSignIn(other, second);
  await buyAndDeliver(other, { productId: product.productId, colour: "Slate" });
  const [itemTwo] = await second.client.get(`/reviews/products/${product.productId}/reviewable-variants`);
  await second.client.post("/reviews", { productId: product.productId, orderItemId: itemTwo.orderItemId, rating: 3, reviewText: "Three." });
  await otherContext.close();

  await page.reload();
  await expect(page.locator(".reviews-score strong")).toHaveText("4.0", { timeout: 20_000 });
  await expect(page.locator(".reviews-heading")).toContainText("2 verified reviews");
});

test("a moderator can still take a review down, and it disappears for everyone", async ({ page, browser }) => {
  const product = await newProduct("Mod");
  const account = await signInAsNewCustomer(page, "mod");
  await buyAndDeliver(page, { productId: product.productId, colour: "Slate" });
  const [item] = await account.client.get(`/reviews/products/${product.productId}/reviewable-variants`);
  const created = await account.client.post("/reviews", {
    productId: product.productId, orderItemId: item.orderItemId, rating: 1, reviewText: "Abusive content here.",
  });
  expect(created.reviewStatus).toBe("PUBLISHED");

  const moderator = await admin();
  await moderator.client.patch(`/reviews/admin/${created.reviewId}/status`, { status: "REJECTED" });

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(`/product/${product.productId}`);
  await expect(guest.locator(".reviews-empty")).toBeVisible({ timeout: 20_000 });
  await expect(guest.locator(".reviews-list")).not.toContainText("Abusive content here.");
  await guestContext.close();

  // Editing a rejected review must not put it straight back on the page.
  await account.client.put(`/reviews/${created.reviewId}`, { rating: 5, reviewText: "Reworded to sneak back." });
  expect(sqlValue(`SELECT REVIEW_STATUS FROM REVIEWS WHERE REVIEW_ID=${created.reviewId}`)).toBe("PENDING");

  const secondGuest = await browser.newContext();
  const guest2 = await secondGuest.newPage();
  await guest2.goto(`/product/${product.productId}`);
  await expect(guest2.locator(".reviews-list")).not.toContainText("Reworded to sneak back.", { timeout: 20_000 });
  await secondGuest.close();
});

test("eligibility is still enforced: no delivered purchase, no duplicate, no invalid rating", async ({ page }) => {
  const product = await newProduct("Elig");
  const account = await signInAsNewCustomer(page, "elig");

  // Never purchased.
  await expect(account.client.post("/reviews", {
    productId: product.productId, orderItemId: 999999, rating: 5, reviewText: "No purchase",
  })).rejects.toThrow();
  await page.goto(`/product/${product.productId}`);
  await expect(page.locator(".review-form")).toHaveCount(0);

  await buyAndDeliver(page, { productId: product.productId, colour: "Slate" });
  const [item] = await account.client.get(`/reviews/products/${product.productId}/reviewable-variants`);
  await account.client.post("/reviews", { productId: product.productId, orderItemId: item.orderItemId, rating: 4, reviewText: "Fine." });

  // Duplicate for the same purchased item.
  await expect(account.client.post("/reviews", {
    productId: product.productId, orderItemId: item.orderItemId, rating: 5, reviewText: "Again",
  })).rejects.toThrow(/already reviewed/i);

  // Out-of-range ratings.
  for (const rating of [0, 6]) {
    await expect(account.client.post("/reviews", {
      productId: product.productId, orderItemId: item.orderItemId, rating, reviewText: "Bad rating",
    })).rejects.toThrow();
  }
});
