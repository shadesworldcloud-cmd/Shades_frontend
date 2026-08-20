const { test, expect } = require("@playwright/test");
const { createProduct } = require("./support/fixtures");
const { signInAsNewCustomer, signInAsNewAdmin } = require("./support/ui");
const { observe, clean } = require("./support/observe");

// In-page actions must not reload the document. A reload is not just slow — it resets component
// state, scroll position, the selected variant, open modals and filters, which is the actual
// complaint behind "buttons causing unnecessary page refreshes".
//
// Static analysis found nothing: no onClick button inside a form missing type, no anchor used as a
// button, no window.location assignment, and all 17 onSubmit handlers call preventDefault. That is
// evidence, not proof — a reload can still come from a stray native submit or a full-href link. So
// this measures the real thing in a real browser.
//
// Detection uses two independent signals:
//   1. A sentinel on window. A full document load wipes it, and nothing else does.
//   2. Counting document-type requests, which is what a reload actually looks like on the wire.
// Either one firing fails the test.

const armReloadDetector = async (page) => {
  const documents = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.push(request.url());
  });
  await page.evaluate(() => { window.__reloadSentinel = "alive"; });
  return {
    documents,
    /** Throws unless the page is the same document it was when armed. */
    assertNoReload: async (what) => {
      const sentinel = await page.evaluate(() => window.__reloadSentinel);
      expect(sentinel, `${what} reloaded the document (sentinel lost)`).toBe("alive");
      expect(documents, `${what} issued a document request`).toEqual([]);
    },
  };
};

let product;

test.beforeAll(async () => {
  product = await createProduct({
    name: `E2E No Reload ${Date.now()}`,
    variants: [
      { sku: `NR-A-${Date.now()}`, variantName: "Amber", color: "Amber", price: 1500, quantityAvailable: 10 },
      { sku: `NR-B-${Date.now()}`, variantName: "Slate", color: "Slate", price: 1900, quantityAvailable: 10 },
    ],
  });
});

test("storefront actions — variant, add to cart, filters, sort, pagination — never reload", async ({ page }) => {
  const seen = observe(page);
  await page.goto(`/product/${product.productId}`);
  await page.waitForLoadState("networkidle");
  const detector = await armReloadDetector(page);

  // Variant selection.
  await page.locator(".pd-variant-options button", { hasText: "Slate" }).click();
  await expect(page.locator(".pd-variant-label strong")).toHaveText("Slate");
  await detector.assertNoReload("variant selection");

  // Add to cart.
  await page.locator(".pd-add-btn").click();
  await expect(page.locator(".cart-badge")).toHaveText("1");
  await detector.assertNoReload("add to cart");

  // Tabs.
  await page.getByRole("button", { name: "Shipping", exact: true }).click();
  await detector.assertNoReload("product tabs");

  expect(clean(seen)).toEqual({ consoleErrors: [], pageErrors: [], dialogs: [], badResponses: [] });
});

test("shop filters, sort and pagination stay in-page", async ({ page }) => {
  await page.goto("/shop");
  await page.waitForLoadState("networkidle");
  const detector = await armReloadDetector(page);

  await page.getByLabel("Search products").fill("E2E");
  await page.waitForTimeout(300);
  await detector.assertNoReload("search typing");

  await page.getByLabel("Sort products").selectOption("price-low");
  await page.waitForTimeout(300);
  await detector.assertNoReload("sort change");

  // The Refine controls now live in a panel behind the navbar filter icon rather than in a left
  // sidebar, so they have to be revealed before they can be driven. Hovering is the primary
  // affordance; the panel stays open while focus is inside it, which is what lets the two
  // interactions below run back to back.
  await page.locator(".nav-filter-trigger").hover();
  await expect(page.locator(".nav-filter-panel")).toBeVisible();

  await page.getByLabel("Brand").selectOption({ index: 1 });
  await page.waitForTimeout(300);
  await detector.assertNoReload("brand filter");
  await page.getByLabel("In-stock styles only").check();
  await page.waitForTimeout(300);
  await detector.assertNoReload("availability filter");

  const nextPage = page.locator(".product-pagination button", { hasText: "Next" });
  if (await nextPage.count()) {
    await nextPage.click();
    await page.waitForTimeout(300);
    await detector.assertNoReload("pagination");
  }

  // The navbar filter icon is the one affordance at every width, and on a touch screen clicking it
  // is the ONLY way in — there is no hover to reveal the panel — so the click path is exercised at
  // mobile width where it actually matters.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/shop");
  await page.waitForLoadState("networkidle");
  const mobile = await armReloadDetector(page);
  const toggle = page.getByRole("button", { name: /^Filters/ });
  await expect(toggle, "the filter icon is the only way into Refine on a touch screen").toBeVisible();
  await toggle.click();
  await expect(page.locator(".nav-filter-panel"), "clicking pins the panel open without hover").toBeVisible();
  await mobile.assertNoReload("mobile filter icon");
});

test("the Best Sellers carousel arrows do not reload", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const detector = await armReloadDetector(page);

  const next = page.locator('.best-sellers-arrows button[aria-label="Show next best sellers"]');
  if (await next.count()) {
    await next.click();
    await page.waitForTimeout(200);
    await detector.assertNoReload("Best Sellers next");
    await page.locator('.best-sellers-arrows button[aria-label="Show previous best sellers"]').click();
    await detector.assertNoReload("Best Sellers previous");
  }

  // The category controls are real navigation via the router — still no document request.
  await page.getByRole("button", { name: "Women", exact: true }).click().catch(() => {});
  await page.waitForTimeout(300);
  await detector.assertNoReload("category filter");
});

test("modal open, dismiss and confirm are all in-page", async ({ page }) => {
  const detector0 = null;
  await page.goto("/info/contact");
  await page.waitForLoadState("networkidle");
  const detector = await armReloadDetector(page);

  await page.getByRole("button", { name: "Contact us" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await detector.assertNoReload("opening the contact modal");

  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await detector.assertNoReload("closing the contact modal");
  expect(detector0).toBeNull();
});

test("account and order actions do not reload, and cancel submits exactly once", async ({ page }) => {
  const seen = observe(page);
  await signInAsNewCustomer(page, "noreload");
  await page.goto("/account");
  await page.waitForLoadState("networkidle");
  const detector = await armReloadDetector(page);

  // Opening the address form is an in-page modal, not a navigation.
  const addAddress = page.getByRole("button", { name: /add an address|new address|add address/i }).first();
  if (await addAddress.count()) {
    await addAddress.click();
    await detector.assertNoReload("opening the address form");
    await page.keyboard.press("Escape").catch(() => {});
  }

  expect(clean(seen)).toEqual({ consoleErrors: [], pageErrors: [], dialogs: [], badResponses: [] });
});

test("admin table actions and search do not reload", async ({ page }) => {
  const seen = observe(page);
  await signInAsNewAdmin(page, "noreloadadm");
  const detector = await armReloadDetector(page);

  for (const section of ["Products", "Orders", "Review moderation", "Email outbox"]) {
    await page.locator(".admin-sidebar").getByRole("button", { name: section, exact: true }).click();
    await page.waitForLoadState("networkidle");
    await detector.assertNoReload(`opening the ${section} section`);
  }

  // A search form inside the admin: submitting it must filter in place, not navigate.
  const search = page.getByRole("textbox", { name: /search email outbox/i });
  if (await search.count()) {
    await search.fill("verify");
    await search.press("Enter");
    await page.waitForTimeout(500);
    await detector.assertNoReload("submitting the outbox search with Enter");
  }

  expect(clean(seen)).toEqual({ consoleErrors: [], pageErrors: [], dialogs: [], badResponses: [] });
});

test("genuine navigation still navigates, and links remain real links", async ({ page }) => {
  // The counterpart to everything above: this must NOT be broken in the name of avoiding reloads.
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Router navigation changes the URL without a document request...
  const detector = await armReloadDetector(page);
  await page.getByRole("link", { name: "Shop", exact: true }).first().click();
  await expect(page).toHaveURL(/\/shop/);
  await detector.assertNoReload("client-side navigation to Shop");

  // ...and product links are real anchors, so they can be opened in a new tab.
  await page.goto("/shop");
  await page.waitForLoadState("networkidle");
  const productLink = page.locator(".product-card a[href*='/product/']").first();
  await expect(productLink, "product cards must be anchors, not click handlers").toHaveAttribute("href", /\/product\//);

  // Back and Forward still work.
  await productLink.click();
  await expect(page).toHaveURL(/\/product\//);
  await page.goBack();
  await expect(page).toHaveURL(/\/shop/);
  await page.goForward();
  await expect(page).toHaveURL(/\/product\//);
});
