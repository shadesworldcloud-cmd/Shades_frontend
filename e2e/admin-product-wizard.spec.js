const { test, expect } = require("@playwright/test");
const { sql, sqlValue, sqlRows } = require("./support/api");
const { admin, disguisedFile, imageFile } = require("./support/fixtures");
const { observe, clean } = require("./support/observe");
const { submitSignIn } = require("./support/ui");

/**
 * The guided Add Product wizard, end to end: a real admin drives the real form in a real browser,
 * and every assertion below reads the database or the storefront — never a mock.
 *
 * The workflow under test: 1. Main product (which IS Variant 1) → 2. "Does this product have more
 * variants?" → 3. Review, then Save as draft or Publish. Publishing is draft-first on the wire, so
 * a photo failure can never leave a half-illustrated product live.
 */

const CLEAN = { consoleErrors: [], pageErrors: [], dialogs: [], badResponses: [] };

const openWizard = async (page) => {
  await page.getByRole("button", { name: /^Products$/ }).click();
  await page.getByRole("button", { name: "+ Add product" }).click();
};

/** Fills the step-1 shared fields plus Variant 1. Scoped queries, so step 2 sections never match. */
const fillMainProduct = async (page, { name, color = "Black", sku, price = "1500", stock = "4" }) => {
  await page.getByLabel(/Product name/).fill(name);
  await page.getByLabel("Men", { exact: true }).check();
  const section = page.locator('[data-variant-section="1"]');
  await section.getByLabel(/^Color/).fill(color);
  await section.getByLabel(/^SKU/).fill(sku);
  await section.getByLabel(/^Price/).fill(price);
  await section.getByLabel(/^Stock/).fill(stock);
};

/** mysql.exe emits \r\n; every cell is trimmed or a mid-list row ends in a stray \r. */
const tidy = (rows) => rows.map((row) => row.map((cell) => cell.trim()));

const productRow = (name) => tidy(sqlRows(
  `SELECT PRODUCT_ID, SLUG, IS_ACTIVE FROM PRODUCTS WHERE PRODUCT_NAME='${name.replace(/'/g, "''")}'`));

test("an admin creates and publishes a single-variant product, and everything persists", async ({ page }) => {
  const account = await admin();
  const stamp = Date.now();
  const name = `E2E Wizard Solo ${stamp}`;
  const seen = observe(page);

  await submitSignIn(page, account, { admin: true });
  await openWizard(page);

  // The form explains that the Main Product is Variant 1 before asking for anything.
  await expect(page.getByText(/The main product is Variant 1/)).toBeVisible();
  await expect(page.getByText("Main product — Variant 1")).toBeVisible();

  await fillMainProduct(page, { name, sku: `WIZ-SOLO-${stamp}` });
  const section = page.locator('[data-variant-section="1"]');
  await section.getByLabel("Main photo for Black").setInputFiles(imageFile("hero.png"));
  await section.getByLabel("Additional photos for Black")
    .setInputFiles([imageFile("detail-1.png"), imageFile("detail-2.png")]);
  await section.getByLabel("Photo description for Black").fill("Wizard solo photo");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2: "No" is the default answer and shows no empty variant forms.
  await expect(page.getByText(/2\. Does this product have more variants\?/)).toBeVisible();
  await expect(page.getByLabel("No, this product has only the main variant")).toBeChecked();
  await expect(page.locator('[data-variant-section="2"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3: the summary names the main variant and the photo counts, then Publish.
  await expect(page.getByText(/3\. Review and save/)).toBeVisible();
  await expect(page.getByText(/3 photo\(s\)/)).toBeVisible();
  await page.getByRole("button", { name: "Publish product" }).click();
  await expect(page.getByText(/is published/)).toBeVisible({ timeout: 30_000 });

  // Exactly one parent product and one variant exist, at position 1, live.
  const rows = productRow(name);
  expect(rows).toHaveLength(1);
  const [productId, , isActive] = rows[0];
  expect(isActive).toBe("1");
  const variants = tidy(sqlRows(`SELECT VARIANT_ID, POSITION FROM PRODUCT_VARIANTS WHERE PRODUCT_ID=${productId}`));
  expect(variants).toHaveLength(1);
  expect(variants[0][1]).toBe("1");
  // Three photos on Variant 1: exactly one main image, distinct display orders.
  const images = tidy(sqlRows(`SELECT IS_PRIMARY, DISPLAY_ORDER FROM PRODUCT_IMAGES
      WHERE PRODUCT_ID=${productId} AND VARIANT_ID=${variants[0][0]}`));
  expect(images).toHaveLength(3);
  expect(images.filter(([primary]) => primary === "1")).toHaveLength(1);
  expect(new Set(images.map(([, order]) => order)).size).toBe(3);

  // Refresh the admin page: the product is still there with its photos, loaded from the server.
  await page.reload();
  await page.getByRole("button", { name: /^Products$/ }).click();
  await page.getByPlaceholder(/Search product/).fill(name);
  await page.getByRole("button", { name: "Edit" }).first().click();
  await expect(page.getByLabel(/Product name/)).toHaveValue(name);
  await expect(page.locator('[data-variant-section="1"] .admin-image-editor li')).toHaveCount(3);

  expect(clean(seen), "the admin flow must be clean").toEqual(CLEAN);
});

test("a multi-variant product: validation names the exact field, values survive, positions persist", async ({ page }) => {
  const account = await admin();
  const stamp = Date.now();
  const name = `E2E Wizard Multi ${stamp}`;

  await submitSignIn(page, account, { admin: true });
  await openWizard(page);
  await fillMainProduct(page, { name, sku: `WIZ-M1-${stamp}`, stock: "3" });
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Yes, add more variants").check();
  await page.getByRole("button", { name: "+ Add variant" }).click();
  await page.getByRole("button", { name: "+ Add variant" }).click();
  await expect(page.getByText("Variant 2")).toBeVisible();
  await expect(page.getByText("Variant 3")).toBeVisible();

  // Remove the third section and re-add it: nothing of the removed draft may survive.
  const third = () => page.locator('[data-variant-section="3"]');
  await third().getByLabel(/^Color/).fill("Doomed");
  await third().getByRole("button", { name: "Remove" }).click();
  await expect(third()).toHaveCount(0);
  await page.getByRole("button", { name: "+ Add variant" }).click();
  await expect(third().getByLabel(/^Color/)).toHaveValue("");

  // Variant 2 filled correctly; variant 3 duplicates variant 1's SKU on purpose.
  const second = page.locator('[data-variant-section="2"]');
  await second.getByLabel(/^Color/).fill("Blue");
  await second.getByLabel(/^SKU/).fill(`WIZ-M2-${stamp}`);
  await second.getByLabel(/^Price/).fill("1750");
  await second.getByLabel(/^Stock/).fill("5");
  await second.getByLabel("Additional photos for Blue").setInputFiles(imageFile("blue.png"));
  await third().getByLabel(/^Color/).fill("Rose");
  await third().getByLabel(/^SKU/).fill(`WIZ-M1-${stamp}`);
  await third().getByLabel(/^Price/).fill("1900");
  await third().getByLabel(/^Stock/).fill("2");

  // The duplicate is blamed on the exact field — variant 3's SKU — and every value survives.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Variant 1 already uses this SKU.")).toBeVisible();
  await expect(second.getByLabel(/^Price/)).toHaveValue("1750");
  await expect(third().getByLabel(/^Color/)).toHaveValue("Rose");

  await third().getByLabel(/^SKU/).fill(`WIZ-M3-${stamp}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Additional variants")).toBeVisible();
  await page.getByRole("button", { name: "Publish product" }).click();
  await expect(page.getByText(/is published/)).toBeVisible({ timeout: 30_000 });

  const [productId] = productRow(name)[0];
  const variants = tidy(sqlRows(`SELECT SKU, POSITION FROM PRODUCT_VARIANTS WHERE PRODUCT_ID=${productId} ORDER BY POSITION`));
  expect(variants).toEqual([
    [`WIZ-M1-${stamp}`, "1"], [`WIZ-M2-${stamp}`, "2"], [`WIZ-M3-${stamp}`, "3"],
  ]);

  // Edit one variant; the others are untouched.
  await page.getByPlaceholder(/Search product/).fill(name);
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('[data-variant-section="2"]').getByLabel(/^Price/).fill("1800");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/was updated/)).toBeVisible({ timeout: 30_000 });
  expect(sqlValue(`SELECT PRICE FROM PRODUCT_VARIANTS WHERE SKU='WIZ-M2-${stamp}'`)).toContain("1800");
  expect(sqlValue(`SELECT PRICE FROM PRODUCT_VARIANTS WHERE SKU='WIZ-M3-${stamp}'`)).toContain("1900");
});

test("the storefront shows ONE card per family, fronted by the Main Product's image", async ({ page }) => {
  const account = await admin();
  const stamp = Date.now();
  const name = `E2E Wizard Card ${stamp}`;

  await submitSignIn(page, account, { admin: true });
  await openWizard(page);
  await fillMainProduct(page, { name, sku: `WIZ-C1-${stamp}` });
  const section = page.locator('[data-variant-section="1"]');
  await section.getByLabel("Main photo for Black").setInputFiles(imageFile("card-hero.png"));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Yes, add more variants").check();
  await page.getByRole("button", { name: "+ Add variant" }).click();
  const second = page.locator('[data-variant-section="2"]');
  await second.getByLabel(/^Color/).fill("Blue");
  await second.getByLabel(/^SKU/).fill(`WIZ-C2-${stamp}`);
  await second.getByLabel(/^Price/).fill("1750");
  await second.getByLabel(/^Stock/).fill("5");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Publish product" }).click();
  await expect(page.getByText(/is published/)).toBeVisible({ timeout: 30_000 });

  const [productId, slug] = productRow(name)[0];
  const mainVariantId = sqlValue(`SELECT VARIANT_ID FROM PRODUCT_VARIANTS WHERE PRODUCT_ID=${productId} AND POSITION=1`);

  // One card for the whole family, not one per variant, fronted by Variant 1's main image and
  // linking to the slug URL.
  await page.goto(`/shop?q=${encodeURIComponent(name)}`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".product-card")).toHaveCount(1);
  await expect(page.locator(".product-card .product-card-image img"))
    .toHaveAttribute("src", new RegExp(`/variants/${mainVariantId}/`));
  const href = await page.locator(".product-card a").first().getAttribute("href");
  expect(href).toContain(`/product/${slug}`);
  expect(href).not.toContain(`/product/${productId}`);

  // Opening it selects the Main Product first; switching to Blue re-keys the whole page and the
  // bag line holds the exact selected variant.
  await page.goto(`/product/${slug}`);
  await expect(page.locator(".pd-variant-label strong")).toHaveText("Black");
  await page.locator(".pd-variant-options button", { hasText: "Blue" }).click();
  await expect(page.locator(".pd-variant-label strong")).toHaveText("Blue");
  await expect(page.locator(".pd-price")).toContainText("1,750");
  await page.locator(".pd-add-btn").click();
  await page.goto("/cart");
  await expect(page.locator(".cart-item").filter({ hasText: "Blue" })).toHaveCount(1);
});

test("a product published in the wizard reaches an ALREADY-OPEN storefront tab without a reload", async ({ page }) => {
  // The reported bug: the storefront fetches its product list once per tab, so a tab opened
  // before a product was published kept showing the old catalogue — the new product missing, and
  // cards for since-removed products answering "Product not found" on click. A window event
  // cannot cross tabs, so the storefront now also resyncs (silently) when its tab regains focus.
  const account = await admin();
  const stamp = Date.now();
  const name = `E2E Wizard TwoTabs ${stamp}`;

  // Tab A: the storefront, opened while the product does not exist yet.
  await page.goto("/");
  await expect(page.locator(".navbar")).toBeVisible();
  await expect(page.locator(".product-card").filter({ hasText: name })).toHaveCount(0);
  await page.evaluate(() => { window.__stillHere = true; });

  // Tab B: the admin publishes the product through the wizard.
  const adminTab = await page.context().newPage();
  await adminTab.bringToFront();
  await submitSignIn(adminTab, account, { admin: true });
  await adminTab.getByRole("button", { name: /^Products$/ }).click();
  await adminTab.getByRole("button", { name: "+ Add product" }).click();
  await adminTab.getByLabel(/Product name/).fill(name);
  await adminTab.getByLabel("Men", { exact: true }).check();
  const section = adminTab.locator('[data-variant-section="1"]');
  await section.getByLabel(/^Color/).fill("Black");
  await section.getByLabel(/^SKU/).fill(`WIZ-2T-${stamp}`);
  await section.getByLabel(/^Price/).fill("1500");
  await section.getByLabel(/^Stock/).fill("4");
  await adminTab.getByRole("button", { name: "Continue" }).click();
  await adminTab.getByRole("button", { name: "Continue" }).click();
  await adminTab.getByRole("button", { name: "Publish product" }).click();
  await expect(adminTab.getByText(/is published/)).toBeVisible({ timeout: 30_000 });

  // Returning to the storefront tab is all it takes — no reload, no manual refresh.
  await page.bringToFront();
  await expect(page.locator(".product-card").filter({ hasText: name })).toHaveCount(1, { timeout: 20_000 });
  expect(await page.evaluate(() => window.__stillHere), "the storefront tab must not have reloaded").toBe(true);
  await adminTab.close();
});

test("Save as draft keeps the product off the storefront until it is published", async ({ page }) => {
  const account = await admin();
  const stamp = Date.now();
  const name = `E2E Wizard Draft ${stamp}`;

  await submitSignIn(page, account, { admin: true });
  await openWizard(page);
  await fillMainProduct(page, { name, sku: `WIZ-D1-${stamp}` });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByText(/saved as a draft/)).toBeVisible({ timeout: 30_000 });

  const [productId, slug, isActive] = productRow(name)[0];
  expect(isActive).toBe("0");
  expect(sqlValue(`SELECT PUBLISHED_AT FROM PRODUCTS WHERE PRODUCT_ID=${productId}`)).toBe("NULL");

  // A draft's URL is a clean 404, indistinguishable from "never existed".
  await page.goto(`/product/${slug}`);
  await expect(page.getByRole("heading", { name: "Product not found" })).toBeVisible();

  // Publishing from the product list makes it live and stamps first publication.
  await page.goto("/admin");
  await page.getByRole("button", { name: /^Products$/ }).click();
  await page.getByPlaceholder(/Search product/).fill(name);
  await page.getByRole("button", { name: "Publish", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
  await expect.poll(() => sqlValue(`SELECT IS_ACTIVE FROM PRODUCTS WHERE PRODUCT_ID=${productId}`)).toBe("1");
  expect(sqlValue(`SELECT PUBLISHED_AT FROM PRODUCTS WHERE PRODUCT_ID=${productId}`)).not.toBe("NULL");

  await page.goto(`/product/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
});

test("a failed photo upload keeps the product a draft and reports the exact file", async ({ page }) => {
  const account = await admin();
  const stamp = Date.now();
  const name = `E2E Wizard PhotoFail ${stamp}`;

  await submitSignIn(page, account, { admin: true });
  await openWizard(page);
  await fillMainProduct(page, { name, sku: `WIZ-F1-${stamp}` });
  const section = page.locator('[data-variant-section="1"]');
  // One good photo and one HTML file disguised as a PNG. The backend decodes every upload, so the
  // disguise is rejected by content — a REAL partial failure, not a mocked one.
  await section.getByLabel("Main photo for Black").setInputFiles(imageFile("good.png"));
  await section.getByLabel("Additional photos for Black").setInputFiles(disguisedFile("evil.png"));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Publish product" }).click();

  // Saved as a draft — never published half-illustrated — and the message names the failed file.
  await expect(page.getByText(/saved as a draft/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/evil\.png/)).toBeVisible();
  const [productId, , isActive] = productRow(name)[0];
  expect(isActive).toBe("0");
  // The good photo landed; the disguised one did not.
  expect(Number(sqlValue(`SELECT COUNT(*) FROM PRODUCT_IMAGES WHERE PRODUCT_ID=${productId}`))).toBe(1);
});

test("the wizard never reloads the page and never opens a native dialog", async ({ page }) => {
  const account = await admin();
  const stamp = Date.now();
  const seen = observe(page);

  await submitSignIn(page, account, { admin: true });
  await openWizard(page);
  await page.evaluate(() => { window.__stillHere = true; });

  await fillMainProduct(page, { name: `E2E Wizard NoReload ${stamp}`, sku: `WIZ-NR-${stamp}` });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Yes, add more variants").check();
  await page.getByRole("button", { name: "+ Add variant" }).click();
  await page.locator('[data-variant-section="2"]').getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByText(/1\. Main product/)).toBeVisible();

  // Add Variant, Remove Variant and step navigation all happened without a page load.
  expect(await page.evaluate(() => window.__stillHere)).toBe(true);

  // Closing with unsaved changes asks through the application modal.
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Discard unsaved changes?")).toBeVisible();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByText(/1\. Main product/)).toHaveCount(0);

  const observed = clean(seen);
  expect(observed.dialogs, "no native dialog may appear").toEqual([]);
  expect(observed.pageErrors).toEqual([]);
});

for (const [label, viewport] of Object.entries({
  desktop: { width: 1280, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
})) {
  test(`the wizard is usable at ${label} width without sideways scrolling`, async ({ page }) => {
    const account = await admin();
    await page.setViewportSize(viewport);
    await submitSignIn(page, account, { admin: true });
    await openWizard(page);
    await expect(page.getByLabel(/Product name/)).toBeVisible();
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth, `${label} overflows horizontally`).toBeLessThanOrEqual(overflow.clientWidth);
    expect(sql("SELECT 1")).toBe("1");
  });
}
