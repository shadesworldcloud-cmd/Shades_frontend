const { test, expect } = require("@playwright/test");
const { admin, createProduct, stockOf } = require("./support/fixtures");
const { sql, sqlValue } = require("./support/api");
const { signInAsNewCustomer } = require("./support/ui");
const { checkout } = require("./support/shop");

// The product page must open on a variant a customer can actually buy, and everything on the page
// must describe that variant — including the photo.
//
// The reported symptom was "the Blue glasses are displayed and selected even though Blue is out of
// stock". Reproduction showed the selection was already right: Orange was selected, with Orange's
// price, SKU and stock. The *photo* was Blue's, because the hero image was seeded from the
// product's isPrimary image before the selected variant's own photo was considered. So a customer
// saw Blue glasses on a page quoting Orange, and the two halves of the page disagreed.
//
// Deep linking did not exist at all: ?variant= was ignored, which is why an out-of-stock deep link
// "fell back" correctly by accident rather than by rule.

let product;
let byName;
let positionOf;

test.beforeAll(async () => {
  const stamp = Date.now();
  product = await createProduct({
    name: `E2E Variant Default ${stamp}`,
    variants: [
      { sku: `VD-BLUE-${stamp}`, variantName: "Blue", color: "Blue", price: 1000, quantityAvailable: 0 },
      { sku: `VD-ORANGE-${stamp}`, variantName: "Orange", color: "Orange", price: 2500, quantityAvailable: 7 },
      { sku: `VD-GREEN-${stamp}`, variantName: "Green", color: "Green", price: 3900, quantityAvailable: 4 },
    ],
  });
  byName = Object.fromEntries(product.variants.map((variant) => [variant.variantName, variant.variantId]));
  // Deep links carry the family POSITION, never the database id — the id would republish exactly
  // the sequential identifier the slug change removed from public URLs.
  positionOf = Object.fromEntries(product.variants.map((variant) => [variant.variantName, variant.position]));

  // The primary photo deliberately belongs to the OUT-OF-STOCK colourway. That is the exact shape
  // that produced the bug; without it this spec would pass against the old code.
  const account = await admin();
  for (const [name, isPrimary] of [["Blue", true], ["Orange", false], ["Green", false]]) {
    await account.client.post(`/products/${product.productId}/images`, {
      imageUrl: `https://images.test/variants/${byName[name]}/${name.toLowerCase()}.jpg`,
      // variantId is now stated, not inferred. PRODUCT_IMAGES gained a real VARIANT_ID column;
      // before that, the association was recovered by matching "/variants/(\d+)/" against this
      // URL, so a fixture could imply it just by naming the file that way. It cannot any more —
      // which is the point of the change, and why this line is the fixture's own bug fix rather
      // than an accommodation.
      variantId: byName[name],
      altText: `${name} photo`, displayOrder: 0, isPrimary,
    });
  }
});

/** Everything the page claims about the currently selected variant, read in one go. */
const shown = (page) => page.evaluate(() => ({
  colour: document.querySelector(".pd-variant-label strong")?.textContent,
  price: document.querySelector(".pd-price")?.textContent,
  stock: document.querySelector(".pd-stock")?.textContent,
  addButton: document.querySelector(".pd-add-btn")?.textContent,
  addDisabled: document.querySelector(".pd-add-btn")?.disabled,
  // .pg-frame, not .pd-main-image: the page's ad-hoc image block was replaced by the
  // ProductGallery component. The rule this asserts is unchanged — the hero photo must depict the
  // variant being quoted and sold — but it is now the gallery's first image rather than a
  // separately-managed activeImage.
  hero: document.querySelector(".pg-frame img")?.getAttribute("src"),
  activeTile: document.querySelector(".pd-variant-options button.active")?.innerText.replace(/\s+/g, " ").trim(),
}));

test("an out-of-stock first variant is not selected, and every field describes the one that is", async ({ page }) => {
  await page.goto(`/product/${product.productId}`);
  await page.waitForLoadState("networkidle");
  const view = await shown(page);

  expect(view.colour, "Orange is the first purchasable colourway").toBe("Orange");
  expect(view.activeTile).toContain("Orange");
  expect(view.price).toContain("2,500");
  expect(view.stock).toContain("7 in stock");
  expect(view.stock).toContain(`VD-ORANGE`);
  expect(view.addButton).toContain("Add Orange to bag");
  expect(view.addDisabled).toBe(false);
  // The regression under test: the hero must be Orange's photo, not the primary Blue one.
  expect(view.hero, "the photo must depict the colourway being quoted")
    .toBe(`https://images.test/variants/${byName.Orange}/orange.jpg`);

  // Details and Shipping are keyed off the same selection.
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.locator(".pd-tab-content")).toContainText(`VD-ORANGE`);
  await page.getByRole("button", { name: "Shipping", exact: true }).click();
  await expect(page.locator(".pd-tab-content")).toContainText("Orange is in stock");
});

test("the out-of-stock colourway is visible, disabled and unpurchasable", async ({ page }) => {
  await page.goto(`/product/${product.productId}`);
  const blueTile = page.locator(".pd-variant-options button", { hasText: "Blue" });
  await expect(blueTile, "out-of-stock options stay visible as disabled tiles").toBeVisible();
  await expect(blueTile).toBeDisabled();
  await expect(blueTile).toContainText("Out of stock");
});

test("the server refuses an out-of-stock variant even when the client asks for it directly", async ({ page }) => {
  // Stale frontend data must not be able to buy something unavailable, so the guarantee has to
  // hold at the API, not just in a disabled button.
  const account = await signInAsNewCustomer(page, "variantguard");
  const before = stockOf(byName.Blue);
  const failed = await account.client.post("/cart/items", { variantId: byName.Blue, quantity: 1 })
    .then(() => null).catch((error) => error);
  expect(failed, "adding an out-of-stock variant must be rejected").not.toBeNull();
  expect(failed.status).toBeGreaterThanOrEqual(400);
  expect(stockOf(byName.Blue), "a rejected add must not move stock").toBe(before);
});

test("a valid in-stock deep link is preserved", async ({ page }) => {
  await page.goto(`/product/${product.productId}?variant=${positionOf.Green}`);
  await page.waitForLoadState("networkidle");
  const view = await shown(page);
  expect(view.colour).toBe("Green");
  expect(view.price).toContain("3,900");
  expect(view.hero).toBe(`https://images.test/variants/${byName.Green}/green.jpg`);
});

test("an out-of-stock, unknown or legacy-id deep link falls back to the first eligible variant", async ({ page }) => {
  for (const [label, target] of [
    ["out of stock", positionOf.Blue],
    ["unknown", 99999999],
    // A pre-redesign link carrying Green's DATABASE id: it names no position, so it must fall
    // back rather than accidentally selecting whatever variant the number happens to match.
    ["legacy raw variant id", byName.Green],
  ]) {
    await page.goto(`/product/${product.productId}?variant=${target}`);
    await page.waitForLoadState("networkidle");
    const view = await shown(page);
    expect(view.colour, `${label} deep link must fall back, not honour a variant nobody can buy`).toBe("Orange");
    expect(view.addDisabled).toBe(false);
  }
});

test("selection survives a manual change, a refresh and browser Back/Forward", async ({ page }) => {
  await page.goto(`/product/${product.productId}`);
  await page.waitForLoadState("networkidle");
  await page.locator(".pd-variant-options button", { hasText: "Green" }).click();
  await expect(page.locator(".pd-variant-label strong")).toHaveText("Green");
  // A manual choice is reflected in the URL as the family position — never the database id.
  await expect(page).toHaveURL(new RegExp(`variant=${positionOf.Green}$`));
  expect(page.url()).not.toContain(`variant=${byName.Green}`);

  await page.reload();
  await page.waitForLoadState("networkidle");
  expect((await shown(page)).colour, "a refresh must not silently reset the colourway").toBe("Green");

  // Navigate away and back: the product page must come back on the same colourway.
  await page.goto("/shop");
  await page.waitForLoadState("networkidle");
  await page.goBack();
  await page.waitForLoadState("networkidle");
  expect((await shown(page)).colour, "Back must restore the deep-linked colourway").toBe("Green");
  await page.goForward();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/\/shop/);
});

test("Add to Cart commits the exact variant that is selected", async ({ page }) => {
  const account = await signInAsNewCustomer(page, "variantadd");
  await page.goto(`/product/${product.productId}?variant=${positionOf.Green}`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".pd-variant-label strong")).toHaveText("Green");
  await page.locator(".pd-add-btn").click();
  await expect(page.locator(".cart-badge")).toHaveText("1");
  await page.waitForLoadState("networkidle");

  const orderId = await checkout(page, { account });
  const soldVariant = sqlValue(`SELECT VARIANT_ID FROM ORDER_ITEMS WHERE ORDER_ID=${Number(orderId)}`);
  expect(Number(soldVariant), "the order must contain the selected variant, not the default one")
    .toBe(Number(byName.Green));
});

test("a product with every variant out of stock says so and cannot be bought", async ({ page }) => {
  const soldOut = await createProduct({
    name: `E2E All Sold Out ${Date.now()}`,
    variants: [{ sku: `VD-DEAD-${Date.now()}`, variantName: "Onyx", color: "Onyx", price: 900, quantityAvailable: 0 }],
  });
  await page.goto(`/product/${soldOut.productId}`);
  await page.waitForLoadState("networkidle");
  const view = await shown(page);
  expect(view.addButton).toContain("Out of stock");
  expect(view.addDisabled).toBe(true);
  expect(view.stock).toContain("Currently unavailable");
});

test("the API returns variants in family order, the Main Product first", async ({ page }) => {
  // The selection rule sorts by position itself, but the entity is ordered too — a rule that
  // silently depends on arrival order is the kind that works until a query changes underneath it.
  await page.goto("/");
  const variants = await page.evaluate(async (productId) => {
    const res = await fetch(`${window.location.origin.replace("3001", "8081")}/api/products/${productId}`);
    return (await res.json()).variants.map((variant) => ({
      position: variant.position, mainVariant: variant.mainVariant,
    }));
  }, product.productId);
  expect(variants.map((variant) => variant.position)).toEqual([1, 2, 3]);
  expect(variants.map((variant) => variant.mainVariant)).toEqual([true, false, false]);
  expect(Number(sqlValue(`SELECT COUNT(*) FROM PRODUCT_VARIANTS WHERE PRODUCT_ID=${product.productId}`))).toBe(3);
  expect(sql(`SELECT 1`)).toBe("1");
});
