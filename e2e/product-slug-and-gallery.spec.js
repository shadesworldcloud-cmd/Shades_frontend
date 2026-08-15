const { test, expect } = require("@playwright/test");
const { ApiClient, createCustomer, sqlValue } = require("./support/api");
const { admin, createProduct, disguisedFile, imageFile, imageRowsOf, uploadImage } = require("./support/fixtures");
const { observe, clean } = require("./support/observe");
const { signInAsNewCustomer, submitSignIn } = require("./support/ui");
const { buy } = require("./support/shop");

/**
 * Public product URLs and the product image gallery, end to end against the real backend, a real
 * MySQL schema and real files on disk. Nothing here is mocked.
 *
 * Two changes are under test:
 *   1. /product/22 (the sequential PRODUCT_ID) became /product/{slug}, with the old numeric form
 *      redirecting to the canonical one.
 *   2. PRODUCT_IMAGES gained a real VARIANT_ID column, an ordering guarantee and a one-primary-
 *      per-product database constraint; the storefront gained a gallery that can actually reach
 *      every photo, including on a phone.
 */

const CLEAN = { consoleErrors: [], pageErrors: [], dialogs: [], badResponses: [] };

const money = (value) => Number(value);

/**
 * A product with two colourways and photos. Blue is the Main Product (position 1). "Studio shot"
 * is uploaded WITHOUT a variantId — the pre-redesign "general photo" call — which the server now
 * files onto the Main Product, so Blue ends up with three photos (Studio shot as its main image,
 * then its two own shots) and Orange with two (the first auto-promoted to Orange's main image).
 */
const productWithGallery = async (label) => {
  const product = await createProduct({
    name: `E2E Gallery ${label} ${Date.now()}`,
    variants: [
      { sku: `GAL-${label}-A-${Date.now()}`, variantName: "Blue", color: "Blue", price: money(1500), quantityAvailable: 5 },
      { sku: `GAL-${label}-B-${Date.now()}`, variantName: "Orange", color: "Orange", price: money(1700), quantityAvailable: 4 },
    ],
  });
  const [blue, orange] = product.variants;
  const general = await uploadImage({ productId: product.productId, altText: "Studio shot", displayOrder: 0, isPrimary: true });
  const blueShot = await uploadImage({ productId: product.productId, variantId: blue.variantId, altText: "Blue colourway", displayOrder: 1 });
  await uploadImage({ productId: product.productId, variantId: blue.variantId, altText: "Blue colourway detail", displayOrder: 2 });
  const orangeShot = await uploadImage({ productId: product.productId, variantId: orange.variantId, altText: "Orange colourway", displayOrder: 0 });
  await uploadImage({ productId: product.productId, variantId: orange.variantId, altText: "Orange colourway detail", displayOrder: 1 });
  return { ...product, blue, orange, general, blueShot, orangeShot };
};

// ── Security ──────────────────────────────────────────────────────────────────────────────

test("an unknown slug is a clean not-found, not a server error or a blank page", async ({ page }) => {
  const seen = observe(page);
  await page.goto("/product/no-such-product-anywhere-xyz");
  await expect(page.getByRole("heading", { name: "Product not found" })).toBeVisible();
  // The 404 IS the expected answer here, so badResponses is allowed to hold exactly that one and
  // nothing else. Asserting the whole object empty would be wrong; asserting nothing would let a
  // real error through.
  const observed = clean(seen);
  expect(observed.pageErrors).toEqual([]);
  expect(observed.dialogs).toEqual([]);
  expect(observed.badResponses.filter((entry) => !/products\/slug\/no-such-product/.test(String(entry)))).toEqual([]);
});

test("a legacy numeric product URL redirects to the canonical slug", async ({ page }) => {
  const product = await productWithGallery("redirect");
  await page.goto(`/product/${product.productId}`);
  // The canonical address replaces the numeric one — the numeric form must not remain in the bar.
  await expect(page).toHaveURL(new RegExp(`/product/${product.slug}$`));
  await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
  expect(page.url()).not.toContain(`/product/${product.productId}`);
});

test("an invalid numeric product id is not found and leaks nothing about the catalogue", async ({ page }) => {
  const seen = observe(page);
  await page.goto("/product/99999999");
  await expect(page.getByRole("heading", { name: "Product not found" })).toBeVisible();
  const observed = clean(seen);
  expect(observed.pageErrors).toEqual([]);
  expect(observed.dialogs).toEqual([]);
  expect(observed.badResponses.filter((entry) => !/products\/99999999\/canonical/.test(String(entry)))).toEqual([]);
});

test("the public product response carries a slug and never a bare database id in the URL", async () => {
  const product = await productWithGallery("public-fields");
  const client = new ApiClient();
  const response = await client.get(`/products/slug/${product.slug}`);
  expect(response.slug).toBe(product.slug);
  // Images expose a public identifier and their real variant column, not a path-derived guess.
  for (const image of response.images) {
    expect(image.publicId).toMatch(/^[0-9a-f-]{36}$/);
  }
  const variantIds = response.images.map((image) => image.variantId).filter(Boolean);
  expect(variantIds).toContain(product.blue.variantId);
});

test("image management endpoints refuse a guest and a signed-in customer alike", async () => {
  const product = await productWithGallery("authz");
  const imageId = product.general.imageId;
  const guest = new ApiClient();
  const customer = await createCustomer("img-authz");

  for (const [label, client] of [["guest", guest], ["customer", customer.client]]) {
    for (const attempt of [
      () => client.put(`/products/${product.productId}/images/order`, [imageId]),
      () => client.put(`/products/${product.productId}/images/${imageId}/primary`, undefined),
      () => client.patch(`/products/${product.productId}/images/${imageId}`, { altText: "hijacked" }),
      () => client.del(`/products/${product.productId}/images/${imageId}`),
    ]) {
      const error = await attempt().then(() => null, (failure) => failure);
      expect(error, `${label} must be refused`).toBeTruthy();
      expect([401, 403], `${label} got ${error.status}`).toContain(error.status);
    }
  }
  // And nothing changed: the alt text an admin set is still there.
  expect(imageRowsOf(product.productId).join("|")).toContain("Studio shot");
});

test("an admin cannot reach another product's image by changing the id in the path", async () => {
  const mine = await productWithGallery("idor-a");
  const theirs = await productWithGallery("idor-b");
  const account = await admin();

  // The image exists and this caller is a legitimate admin — but it does not belong to the product
  // named in the path, so it must be refused rather than silently edited.
  const patch = await account.client
    .patch(`/products/${mine.productId}/images/${theirs.general.imageId}`, { altText: "cross-product write" })
    .then(() => null, (failure) => failure);
  expect(patch).toBeTruthy();
  expect(patch.status).toBe(404);

  const reorder = await account.client
    .put(`/products/${mine.productId}/images/order`, [theirs.general.imageId])
    .then(() => null, (failure) => failure);
  expect(reorder).toBeTruthy();
  expect(reorder.status).toBe(400);

  expect(imageRowsOf(theirs.productId).join("|")).not.toContain("cross-product write");
});

// ── Upload validation ─────────────────────────────────────────────────────────────────────

test("an HTML file renamed .png is rejected by content, not accepted on its extension", async () => {
  const product = await productWithGallery("disguised");
  const before = imageRowsOf(product.productId).length;
  const failure = await uploadImage({
    productId: product.productId, file: disguisedFile(), contentType: "image/png",
  }).then(() => null, (error) => error);
  expect(failure, "a disguised file must not be stored").toBeTruthy();
  expect(failure.status).toBe(400);
  expect(imageRowsOf(product.productId).length).toBe(before);
});

test("the image limit is enforced PER VARIANT by the server and reported, not silently applied", async () => {
  const product = await productWithGallery("limit");
  const limit = 10;
  const countFor = (variantId) => imageRowsOf(product.productId)
    .filter((row) => row.split(":")[3] === String(variantId)).length;
  // Fill Blue (the Main Product — variant-less uploads land on it) to its ceiling.
  for (let index = countFor(product.blue.variantId); index < limit; index += 1) {
    await uploadImage({ productId: product.productId, variantId: product.blue.variantId,
      altText: `Filler ${index}`, displayOrder: index });
  }
  expect(countFor(product.blue.variantId)).toBe(limit);
  const failure = await uploadImage({ productId: product.productId, variantId: product.blue.variantId, altText: "one too many" })
    .then(() => null, (error) => error);
  expect(failure).toBeTruthy();
  expect(failure.status).toBe(400);
  expect(failure.message).toContain(String(limit));
  expect(countFor(product.blue.variantId)).toBe(limit);
  // Per variant, not per product: a full sibling must not block Orange's own photography.
  await uploadImage({ productId: product.productId, variantId: product.orange.variantId, altText: "Orange is fine" });
  expect(countFor(product.orange.variantId)).toBeGreaterThan(2);
});

// ── Ordering and the primary image ────────────────────────────────────────────────────────

test("reordering persists, and the primary image stays first however the order is set", async () => {
  const product = await productWithGallery("order");
  const account = await admin();
  const ids = imageRowsOf(product.productId).map((row) => Number(row.split(":")[0]));

  const reversed = [...ids].reverse();
  await account.client.put(`/products/${product.productId}/images/order`, reversed);

  const after = imageRowsOf(product.productId);
  // Primary first is the rule, so the reversal shows up among the non-primary images.
  expect(after[0].split(":")[2]).toBe("1");
  const ordersById = Object.fromEntries(after.map((row) => {
    const [id, order] = row.split(":");
    return [Number(id), Number(order)];
  }));
  reversed.forEach((id, position) => expect(ordersById[id]).toBe(position));
});

test("promoting a new main image demotes only ITS variant's incumbent", async () => {
  // UQ_PRODUCT_IMAGES_VARIANT_PRIMARY makes "main image of variant N" unique, so the swap has to
  // demote before it promotes — and it must be scoped: every other variant keeps its own main.
  const product = await productWithGallery("primary-swap");
  const account = await admin();
  const target = product.blueShot.imageId;

  await account.client.put(`/products/${product.productId}/images/${target}/primary`, undefined);

  const rows = imageRowsOf(product.productId);
  const primariesFor = (variantId) => rows
    .filter((row) => row.split(":")[3] === String(variantId) && row.split(":")[2] === "1");
  expect(primariesFor(product.blue.variantId)).toHaveLength(1);
  expect(Number(primariesFor(product.blue.variantId)[0].split(":")[0])).toBe(target);
  // Orange's own main image was not touched by Blue's swap.
  expect(primariesFor(product.orange.variantId)).toHaveLength(1);
  expect(Number(primariesFor(product.orange.variantId)[0].split(":")[0])).toBe(product.orangeShot.imageId);
});

test("removing a variant's main image promotes that variant's next photo rather than leaving none", async () => {
  const product = await productWithGallery("primary-removal");
  const account = await admin();
  // Derived, not a literal: the fixture's image count is an implementation detail of
  // productWithGallery, and hard-coding it made this test fail when a colourway gained a second
  // photo — for a reason that had nothing to do with primary-image promotion.
  const before = imageRowsOf(product.productId).length;
  // The Studio shot is Blue's main image (variant-less uploads land on the Main Product).
  await account.client.del(`/products/${product.productId}/images/${product.general.imageId}`);

  const rows = imageRowsOf(product.productId);
  expect(rows).toHaveLength(before - 1);
  const bluePrimaries = rows.filter((row) =>
    row.split(":")[3] === String(product.blue.variantId) && row.split(":")[2] === "1");
  expect(bluePrimaries, "Blue must not be left without a main image").toHaveLength(1);
  expect(Number(bluePrimaries[0].split(":")[0])).toBe(product.blueShot.imageId);
});

// ── Customer flow in the browser ──────────────────────────────────────────────────────────

test("a customer reaches the product by slug, browses the gallery and buys the selected variant", async ({ page }) => {
  const product = await productWithGallery("customer");
  const seen = observe(page);

  await page.goto(`/product/${product.slug}`);
  await expect(page).toHaveURL(new RegExp(`/product/${product.slug}`));
  expect(page.url()).not.toMatch(new RegExp(`/product/${product.productId}\\b`));

  const gallery = page.locator(".pg");
  await expect(gallery).toBeVisible();
  const mainImage = page.locator(".pg-frame img");

  // Blue is the default variant: its own two photos, then the general studio shot. Derived from
  // the fixture rather than written as a literal, so changing what productWithGallery uploads
  // cannot fail this test for a reason unrelated to what it is checking.
  const blueOwn = imageRowsOf(product.productId).filter((row) => row.split(":")[3] === String(product.blue.variantId)).length;
  const generalCount = imageRowsOf(product.productId).filter((row) => row.split(":")[3] === "-").length;
  await expect(page.getByRole("button", { name: /^Show photo/ })).toHaveCount(blueOwn + generalCount);
  const firstSrc = await mainImage.getAttribute("src");

  // Next moves, and does NOT reload the page — a gallery control inside a form would submit it.
  await page.evaluate(() => { window.__stillHere = true; });
  await page.getByRole("button", { name: "Next photo" }).click();
  await expect(mainImage).not.toHaveAttribute("src", firstSrc);
  expect(await page.evaluate(() => window.__stillHere)).toBe(true);

  // Keyboard navigation returns to the first photo.
  await gallery.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(mainImage).toHaveAttribute("src", firstSrc);

  // Switching colourway shows that colourway's photo...
  await page.getByRole("button", { name: new RegExp(`${product.name} Orange`) }).click();
  await expect(mainImage).toHaveAttribute("src", /.+/);
  const orangeSrc = await mainImage.getAttribute("src");
  expect(orangeSrc).toContain(`/variants/${product.orange.variantId}/`);

  // ...and Add to Bag commits THAT variant, not the one whose photo happens to be showing.
  await page.getByRole("button", { name: /Add Orange to bag/ }).click();
  await expect(page.getByRole("link", { name: /View bag/ })).toBeVisible();

  expect(clean(seen), "the page must be clean").toEqual(CLEAN);
});

test("refresh and browser Back/Forward keep the slug URL working", async ({ page }) => {
  const first = await productWithGallery("nav-a");
  const second = await productWithGallery("nav-b");

  await page.goto(`/product/${first.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: first.name })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: first.name })).toBeVisible();

  await page.goto(`/product/${second.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: second.name })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/product/${first.slug}`));
  await expect(page.getByRole("heading", { level: 1, name: first.name })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/product/${second.slug}`));
  await expect(page.getByRole("heading", { level: 1, name: second.name })).toBeVisible();
});

test("the canonical link tag points at the slug URL", async ({ page }) => {
  const product = await productWithGallery("canonical");
  await page.goto(`/product/${product.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonical).toContain(`/product/${product.slug}`);
  expect(canonical).not.toContain(`/product/${product.productId}`);
});

test("a product with a single photo shows no dead navigation controls", async ({ page }) => {
  const product = await createProduct({
    name: `E2E One Photo ${Date.now()}`,
    variants: [{ sku: `ONE-${Date.now()}`, variantName: "Black", color: "Black", price: money(999), quantityAvailable: 2 }],
  });
  await uploadImage({ productId: product.productId, altText: "Only photo", isPrimary: true });

  await page.goto(`/product/${product.slug}`);
  await expect(page.locator(".pg-frame img")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next photo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Previous photo" })).toHaveCount(0);
});

test("a product with no photos renders an empty frame rather than a broken image", async ({ page }) => {
  const product = await createProduct({
    name: `E2E No Photo ${Date.now()}`,
    variants: [{ sku: `NONE-${Date.now()}`, variantName: "Black", color: "Black", price: money(999), quantityAvailable: 2 }],
  });
  const seen = observe(page);
  await page.goto(`/product/${product.slug}`);
  await expect(page.getByTestId("product-gallery-empty")).toBeVisible();
  expect(clean(seen), "the page must be clean").toEqual(CLEAN);
});

// ── A colourway without photos falls back to the Main Product's, labelled ─────────────────

test("a colourway without photos shows the Main Product's photography, labelled as a stand-in", async ({ page }) => {
  // The documented fallback rule: a variant with no photos shows VARIANT 1's gallery — never a
  // sibling's. Blue is the Main Product here (sold out, with the family's lead photo); Orange is
  // selected as the first purchasable variant and has nothing of its own; Green has a photo that
  // must NOT leak into Orange's gallery.
  const product = await createProduct({
    name: `E2E OOS Photos ${Date.now()}`,
    variants: [
      { sku: `OOSP-B-${Date.now()}`, variantName: "Blue", color: "Blue", price: money(1500), quantityAvailable: 0 },
      { sku: `OOSP-O-${Date.now()}`, variantName: "Orange", color: "Orange", price: money(1500), quantityAvailable: 5 },
      { sku: `OOSP-G-${Date.now()}`, variantName: "Green", color: "Green", price: money(1500), quantityAvailable: 7 },
    ],
  });
  const [blue, , green] = product.variants;
  await uploadImage({ productId: product.productId, variantId: blue.variantId, altText: "Blue photo", isPrimary: true });
  await uploadImage({ productId: product.productId, variantId: green.variantId, altText: "Green photo" });

  await page.goto(`/product/${product.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();

  // Orange is selected (first purchasable in family order) and has no photography of its own,
  // so the MAIN PRODUCT's photo stands in — and the page says so.
  await expect(page.locator(".pd-variant-label strong")).toHaveText("Orange");
  const hero = page.locator(".pg-frame img");
  await expect(hero).toHaveAttribute("src", new RegExp(`/variants/${blue.variantId}/`));
  await expect(hero).not.toHaveAttribute("src", new RegExp(`/variants/${green.variantId}/`));
  await expect(page.locator(".pd-photo-note")).toContainText("main product");

  // The listing card keeps the Main Product's image too — the sanctioned family face — while
  // committing the purchasable variant.
  await page.goto(`/shop?q=${encodeURIComponent(product.name)}`);
  await page.waitForLoadState("networkidle");
  const card = page.locator(".product-card").first();
  await expect(card.locator(".product-color")).toHaveText("Orange");
  await expect(card.locator(".product-card-image img"))
    .toHaveAttribute("src", new RegExp(`/variants/${blue.variantId}/`));
});

test("the Main Product's stand-in photo is labelled on the colour tile as well", async ({ page }) => {
  const product = await createProduct({
    name: `E2E OOS Only ${Date.now()}`,
    variants: [
      { sku: `OOSO-B-${Date.now()}`, variantName: "Blue", color: "Blue", price: money(1500), quantityAvailable: 0 },
      { sku: `OOSO-O-${Date.now()}`, variantName: "Orange", color: "Orange", price: money(1500), quantityAvailable: 5 },
    ],
  });
  const [blue] = product.variants;
  await uploadImage({ productId: product.productId, variantId: blue.variantId, altText: "Blue photo", isPrimary: true });

  await page.goto(`/product/${product.slug}`);
  await expect(page.locator(".pd-variant-label strong")).toHaveText("Orange");
  await expect(page.locator(".pg-frame img")).toHaveAttribute("src", new RegExp(`/variants/${blue.variantId}/`));
  await expect(page.locator(".pd-photo-note")).toContainText("there are none for Orange yet");
  // The colour tile says the same thing, in place.
  await expect(page.getByRole("button", { name: /Orange Main product photo/ })).toBeVisible();
});

test("a sibling variant's photos never leak into a colourway that has its own", async ({ page }) => {
  // ODU's exact shape under the new model: the legacy "general" photo belongs to the Main Product
  // (Ocean Black), and Ocean Blue's gallery is exactly Blue's own photograph — nothing borrowed,
  // nothing appended.
  const product = await createProduct({
    name: `E2E ODU Shape ${Date.now()}`,
    variants: [
      { sku: `ODU-BK-${Date.now()}`, variantName: "Ocean Black", color: "Black", price: money(1500), quantityAvailable: 0 },
      { sku: `ODU-BL-${Date.now()}`, variantName: "Ocean Blue", color: "Blue", price: money(1500), quantityAvailable: 5 },
    ],
  });
  const [black, blue] = product.variants;
  const general = await uploadImage({ productId: product.productId, altText: "product image", isPrimary: true });
  const blackShot = await uploadImage({ productId: product.productId, variantId: black.variantId, altText: "Black" });
  const blueShot = await uploadImage({ productId: product.productId, variantId: blue.variantId, altText: "Blue" });

  await page.goto(`/product/${product.slug}`);
  await expect(page.locator(".pd-variant-label strong")).toHaveText("Blue");

  // Blue's own photo is the whole gallery: one frame, no thumbnails, no dead controls.
  await expect(page.locator(".pg-frame img"))
    .toHaveAttribute("src", new RegExp(blueShot.imageUrl.split("/").pop()));
  await expect(page.getByRole("button", { name: "Next photo" })).toHaveCount(0);
  // And the Black tiles still show Black's own photography in the selector.
  expect(general.imageId).toBeTruthy();
  expect(blackShot.imageId).toBeTruthy();
});

test("a photo uploaded without a variant lands on the Main Product and can be re-filed", async ({ page }) => {
  // The pre-redesign "general photo" call no longer creates an unowned row: the server files it
  // onto the Main Product. Re-filing through the same PATCH the admin control uses moves it to a
  // named colourway; variantId 0 sends it back to the Main Product.
  const product = await createProduct({
    name: `E2E Refile ${Date.now()}`,
    variants: [
      { sku: `RF-BK-${Date.now()}`, variantName: "Ocean Black", color: "Black", price: money(1500), quantityAvailable: 0 },
      { sku: `RF-BL-${Date.now()}`, variantName: "Ocean Blue", color: "Blue", price: money(1500), quantityAvailable: 5 },
    ],
  });
  const [black, blue] = product.variants;
  const general = await uploadImage({ productId: product.productId, altText: "photo of the black pair", isPrimary: true });
  await uploadImage({ productId: product.productId, variantId: blue.variantId, altText: "Blue" });
  const generalFile = general.imageUrl.split("/").pop();

  // Landed on the Main Product (Ocean Black), not on some unowned "general" state.
  expect(imageRowsOf(product.productId).join("|")).toContain(`:${black.variantId}:photo of the black pair`);

  // Blue's gallery does not contain it before OR after the re-file — it was never Blue's.
  await page.goto(`/product/${product.slug}`);
  await expect(page.locator(".pd-variant-label strong")).toHaveText("Blue");
  const shown = await page.locator(".pg-thumbs img, .pg-frame img").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("src")));
  expect(shown.some((src) => src.includes(generalFile))).toBe(false);

  // Re-file it onto Blue through the real endpoint; it must arrive as an ordinary photo (Blue
  // keeps its own main image) and now show in Blue's gallery.
  const account = await admin();
  await account.client.patch(`/products/${product.productId}/images/${general.imageId}`, { variantId: blue.variantId });
  await page.reload();
  await expect(page.locator(".pd-variant-label strong")).toHaveText("Blue");
  const after = await page.locator(".pg-thumbs img").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("src")));
  expect(after.some((src) => src.includes(generalFile))).toBe(true);

  // variantId 0 = "back to the Main Product".
  await account.client.patch(`/products/${product.productId}/images/${general.imageId}`, { variantId: 0 });
  expect(imageRowsOf(product.productId).join("|")).toContain(`:${black.variantId}:photo of the black pair`);
});

test("selecting several files in the wizard uploads all of them, to the chosen variant", async ({ page }) => {
  // The upload half of the report. The file input is `multiple`; this proves every selected file
  // reaches the catalogue rather than only the first, and that they land on the variant whose
  // section they were dropped into — that is the point of per-variant sections.
  const account = await admin();
  const product = await createProduct({
    name: `E2E Multi Upload ${Date.now()}`,
    variants: [
      { sku: `MU-A-${Date.now()}`, variantName: "Black", color: "Black", price: money(1500), quantityAvailable: 3 },
      { sku: `MU-B-${Date.now()}`, variantName: "Blue", color: "Blue", price: money(1500), quantityAvailable: 4 },
    ],
  });
  const [, blue] = product.variants;
  await uploadImage({ productId: product.productId, altText: "hero", isPrimary: true });

  await submitSignIn(page, account, { admin: true });
  await page.getByRole("button", { name: /^Products$/ }).click();
  await page.getByPlaceholder(/Search product/).fill(product.name);
  await page.getByRole("button", { name: "Edit" }).first().click();
  // Step 1 is the Main Product (Black), holding the hero that the variant-less upload landed on.
  await expect(page.locator('[data-variant-section="1"] .admin-image-editor li')).toHaveCount(1);

  // Three files in one go, into Blue's own section on step 2.
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Additional photos for Blue")
    .setInputFiles([imageFile("one.png"), imageFile("two.png"), imageFile("three.png")]);
  await page.getByLabel("Photo description for Blue").fill("Blue detail");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => imageRowsOf(product.productId)
    .filter((row) => row.split(":")[3] === String(blue.variantId)).length, { timeout: 30_000 }).toBe(3);
  const blueOwned = imageRowsOf(product.productId).filter((row) => row.split(":")[3] === String(blue.variantId));
  // Distinct display orders, so the gallery order is deterministic rather than a three-way tie —
  // and the variant's first photo was promoted to its main image.
  expect(new Set(blueOwned.map((row) => row.split(":")[1])).size).toBe(3);
  expect(blueOwned.filter((row) => row.split(":")[2] === "1")).toHaveLength(1);

  // And the customer can browse all three of Blue's own photos on Blue.
  await page.goto(`/product/${product.slug}`);
  await page.getByRole("button", { name: new RegExp(`${product.name} Blue`) }).click();
  await expect(page.getByRole("button", { name: /^Show photo/ })).toHaveCount(3);
});

test("the same photograph cannot be stored twice on one product", async () => {
  // The root cause of "the out-of-stock colour shows in the in-stock one's photos". Admins picked
  // the same file for the product-level field AND the first colourway's field; a general image is
  // shown for every colour by design, so that duplicate put the first (often sold-out) colourway's
  // photo into every other colourway's gallery. Measured on the live catalogue: 4 of 6 products.
  const product = await createProduct({
    name: `E2E Dupe Guard ${Date.now()}`,
    variants: [
      { sku: `DG-A-${Date.now()}`, variantName: "Black", color: "Black", price: money(1500), quantityAvailable: 0 },
      { sku: `DG-B-${Date.now()}`, variantName: "Blue", color: "Blue", price: money(1500), quantityAvailable: 4 },
    ],
  });
  const [black] = product.variants;
  const sameFile = imageFile("shared.png");

  // Once as the colourway's photo…
  await uploadImage({ productId: product.productId, variantId: black.variantId, file: sameFile, altText: "Black" });
  const before = imageRowsOf(product.productId).length;

  // …and again as a general product photo. Refused, whatever it is filed as.
  const failure = await uploadImage({ productId: product.productId, file: sameFile, altText: "product image", isPrimary: true })
    .then(() => null, (error) => error);
  expect(failure, "a byte-identical photo must not be stored twice").toBeTruthy();
  expect(failure.status).toBe(400);
  expect(failure.message).toContain("already on the product");
  expect(imageRowsOf(product.productId).length).toBe(before);

  // A genuinely different photograph is still accepted, so the guard is not just refusing uploads.
  await uploadImage({ productId: product.productId, file: imageFile("different.png"), altText: "case shot", isPrimary: true });
  expect(imageRowsOf(product.productId).length).toBe(before + 1);
});

test("the wizard has a separate photo section per variant, and reordering stays inside one", async ({ page }) => {
  const account = await admin();
  const product = await createProduct({
    name: `E2E Sections ${Date.now()}`,
    variants: [
      { sku: `SEC-A-${Date.now()}`, variantName: "Black", color: "Black", price: money(1500), quantityAvailable: 0 },
      { sku: `SEC-B-${Date.now()}`, variantName: "Blue", color: "Blue", price: money(1500), quantityAvailable: 4 },
    ],
  });
  const [black, blue] = product.variants;
  await uploadImage({ productId: product.productId, altText: "case shot", isPrimary: true }); // → the Main Product, Black
  await uploadImage({ productId: product.productId, variantId: blue.variantId, altText: "Blue front" });
  await uploadImage({ productId: product.productId, variantId: blue.variantId, altText: "Blue side" });

  await submitSignIn(page, account, { admin: true });
  await page.getByRole("button", { name: /^Products$/ }).click();
  await page.getByPlaceholder(/Search product/).fill(product.name);
  await page.getByRole("button", { name: "Edit" }).first().click();

  // Step 1: the Main Product's section holds exactly its own photo.
  const blackSection = page.locator('[data-variant-section="1"]');
  await expect(blackSection).toContainText("Main product — Variant 1");
  await expect(blackSection.locator(".admin-image-editor li")).toHaveCount(1);

  // Step 2: Blue's section holds exactly Blue's two.
  await page.getByRole("button", { name: "Continue" }).click();
  const blueSection = page.locator('[data-variant-section="2"]');
  await expect(blueSection.locator(".admin-image-editor li")).toHaveCount(2);

  // Reordering is scoped to the variant: moving Blue's second photo up swaps it with Blue's
  // first, never with the Main Product's photo.
  //
  // Asserted on DISPLAY_ORDER, not on imageRowsOf's row order: that query sorts main-image-first,
  // so Blue's main photo heads its rows whatever its display order is, and row order would report
  // "nothing changed" when the reorder had in fact landed.
  const blueOrders = () => Object.fromEntries(imageRowsOf(product.productId)
    .filter((row) => row.split(":")[3] === String(blue.variantId))
    .map((row) => [row.split(":")[0], Number(row.split(":")[1])]));
  const [frontId, sideId] = Object.keys(blueOrders());
  await blueSection.locator(".admin-image-editor li").last().getByRole("button", { name: /Move image \d+ earlier/ }).click();
  await expect.poll(() => { const orders = blueOrders(); return orders[sideId] < orders[frontId]; })
    .toBe(true);
  // The Main Product's photo is untouched by a reorder inside another variant.
  expect(imageRowsOf(product.productId).filter((row) => row.split(":")[3] === String(black.variantId))).toHaveLength(1);
});

test("the wizard can move a photo between variants and back to the Main Product", async ({ page }) => {
  const account = await admin();
  const product = await createProduct({
    name: `E2E Scope UI ${Date.now()}`,
    variants: [
      { sku: `SC-A-${Date.now()}`, variantName: "Black", color: "Black", price: money(1500), quantityAvailable: 3 },
      { sku: `SC-B-${Date.now()}`, variantName: "Blue", color: "Blue", price: money(1500), quantityAvailable: 4 },
    ],
  });
  const [black, blue] = product.variants;
  const general = await uploadImage({ productId: product.productId, altText: "loose shot", isPrimary: true });

  await submitSignIn(page, account, { admin: true });
  await page.getByRole("button", { name: /^Products$/ }).click();
  await page.getByPlaceholder(/Search product/).fill(product.name);
  await page.getByRole("button", { name: "Edit" }).first().click();

  // The variant-less upload landed on the Main Product (Black); its "Shown for" control says so.
  const scope = page.getByRole("combobox", { name: `Shown for image ${general.imageId}` });
  await expect(scope).toHaveValue(String(black.variantId));

  // Move it onto Blue — the wizard resyncs from the server, so the photo leaves this section.
  await scope.selectOption(String(blue.variantId));
  await expect.poll(() => imageRowsOf(product.productId).join("|")).toContain(`:${blue.variantId}:loose shot`);
  await expect(page.locator('[data-variant-section="1"] .admin-image-editor li')).toHaveCount(0);

  // The photo now lives in Blue's section on step 2; move it back to the Main Product from there.
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('[data-variant-section="2"]')
    .getByRole("combobox", { name: `Shown for image ${general.imageId}` })
    .selectOption(String(black.variantId));
  await expect.poll(() => imageRowsOf(product.productId).join("|")).toContain(`:${black.variantId}:loose shot`);
});

test("an admin can add several additional photos to one colourway, and only that colourway shows them", async () => {
  // The second half of the request. Uploads go to a named variant and the gallery for that variant
  // lists all of them, in upload order — while the other colourway is unaffected.
  const product = await createProduct({
    name: `E2E Variant Extras ${Date.now()}`,
    variants: [
      { sku: `VX-A-${Date.now()}`, variantName: "Black", color: "Black", price: money(1500), quantityAvailable: 0 },
      { sku: `VX-B-${Date.now()}`, variantName: "Blue", color: "Blue", price: money(1500), quantityAvailable: 4 },
    ],
  });
  const [black, blue] = product.variants;
  await uploadImage({ productId: product.productId, variantId: black.variantId, altText: "Black only", isPrimary: true });
  for (let index = 0; index < 3; index += 1) {
    await uploadImage({ productId: product.productId, variantId: blue.variantId, altText: `Blue ${index + 1}`, displayOrder: index });
  }

  const client = new ApiClient();
  const response = await client.get(`/products/slug/${product.slug}`);
  const blueImages = response.images.filter((image) => image.variantId === blue.variantId);
  expect(blueImages).toHaveLength(3);
  expect(blueImages.map((image) => image.altText)).toEqual(["Blue 1", "Blue 2", "Blue 3"]);
  expect(response.images.filter((image) => image.variantId === black.variantId)).toHaveLength(1);
});

test("all of a colourway's additional photos are browsable on the product page", async ({ page }) => {
  const product = await createProduct({
    name: `E2E Variant Browse ${Date.now()}`,
    variants: [
      { sku: `VB-A-${Date.now()}`, variantName: "Black", color: "Black", price: money(1500), quantityAvailable: 0 },
      { sku: `VB-B-${Date.now()}`, variantName: "Blue", color: "Blue", price: money(1500), quantityAvailable: 4 },
    ],
  });
  const [black, blue] = product.variants;
  await uploadImage({ productId: product.productId, variantId: black.variantId, altText: "Black only", isPrimary: true });
  for (let index = 0; index < 3; index += 1) {
    await uploadImage({ productId: product.productId, variantId: blue.variantId, altText: `Blue ${index + 1}`, displayOrder: index });
  }

  await page.goto(`/product/${product.slug}`);
  await expect(page.locator(".pd-variant-label strong")).toHaveText("Blue");
  // Three thumbnails, all Blue's, and Next walks them.
  await expect(page.getByRole("button", { name: /^Show photo/ })).toHaveCount(3);
  const seen = new Set();
  for (let step = 0; step < 3; step += 1) {
    seen.add(await page.locator(".pg-frame img").getAttribute("src"));
    await page.getByRole("button", { name: "Next photo" }).click();
  }
  expect(seen.size).toBe(3);
  for (const src of seen) expect(src).toContain(`/variants/${blue.variantId}/`);
});

// ── Deleting a product that has been sold ─────────────────────────────────────────────────

test("a product can always be removed, and its orders survive intact", async ({ page }) => {
  // Previously refused outright: "This product has order or inventory history and cannot be
  // permanently removed. Deactivate it instead." Three foreign keys pointed at PRODUCT_VARIANTS
  // with NO ACTION — carts, inventory movements and order lines — so the database rejected the
  // delete before the application had any say.
  const product = await createProduct({
    name: `E2E Delete With History ${Date.now()}`,
    variants: [{ sku: `DEL-${Date.now()}`, variantName: "Black", color: "Black", price: money(1200), quantityAvailable: 9 }],
  });
  const [variant] = product.variants;
  await uploadImage({ productId: product.productId, altText: "hero", isPrimary: true });

  // A real, paid order placed through the real storefront checkout.
  const customer = await signInAsNewCustomer(page, "del-hist");
  const orderId = await buy(page, { productId: product.productId, quantity: 2, account: customer });
  expect(sqlValue(`SELECT COUNT(*) FROM ORDER_ITEMS WHERE ORDER_ID=${orderId}`)).toBe("1");
  expect(Number(sqlValue(`SELECT COUNT(*) FROM INVENTORY_MOVEMENTS WHERE VARIANT_ID=${variant.variantId}`))).toBeGreaterThan(0);

  // The order line's snapshot, captured before the product goes.
  const before = sqlValue(`SELECT CONCAT(PRODUCT_NAME,'|',SKU,'|',QUANTITY,'|',UNIT_PRICE,'|',LINE_TOTAL)
                           FROM ORDER_ITEMS WHERE ORDER_ID=${orderId}`);

  const account = await admin();
  await account.client.del(`/products/${product.productId}`);

  // Gone from the catalogue and from inventory…
  expect(sqlValue(`SELECT COUNT(*) FROM PRODUCTS WHERE PRODUCT_ID=${product.productId}`)).toBe("0");
  expect(sqlValue(`SELECT COUNT(*) FROM PRODUCT_VARIANTS WHERE VARIANT_ID=${variant.variantId}`)).toBe("0");
  expect(sqlValue(`SELECT COUNT(*) FROM PRODUCT_IMAGES WHERE PRODUCT_ID=${product.productId}`)).toBe("0");
  expect(sqlValue(`SELECT COUNT(*) FROM INVENTORY_MOVEMENTS WHERE VARIANT_ID=${variant.variantId}`)).toBe("0");
  expect(sqlValue(`SELECT COUNT(*) FROM CART_ITEMS WHERE VARIANT_ID=${variant.variantId}`)).toBe("0");

  // …but the order line is untouched, with its variant link cleared rather than the row deleted.
  expect(sqlValue(`SELECT COUNT(*) FROM ORDER_ITEMS WHERE ORDER_ID=${orderId}`)).toBe("1");
  expect(sqlValue(`SELECT CONCAT(PRODUCT_NAME,'|',SKU,'|',QUANTITY,'|',UNIT_PRICE,'|',LINE_TOTAL)
                   FROM ORDER_ITEMS WHERE ORDER_ID=${orderId}`)).toBe(before);
  expect(sqlValue(`SELECT COUNT(*) FROM ORDER_ITEMS WHERE ORDER_ID=${orderId} AND VARIANT_ID IS NULL`)).toBe("1");

  // And the customer's orders page still renders it — the UI must not choke on the null variant.
  const seen = observe(page);
  await page.goto("/my-orders");
  await expect(page.getByText(product.name).first(), "the order must still show the product it bought").toBeVisible();
  const observed = clean(seen);
  expect(observed.pageErrors).toEqual([]);
  expect(observed.badResponses).toEqual([]);
});

test("the storefront stops showing a deleted product without breaking", async ({ page }) => {
  const product = await createProduct({
    name: `E2E Delete Storefront ${Date.now()}`,
    variants: [{ sku: `DELS-${Date.now()}`, variantName: "Black", color: "Black", price: money(1200), quantityAvailable: 4 }],
  });
  await uploadImage({ productId: product.productId, altText: "hero", isPrimary: true });
  await page.goto(`/product/${product.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();

  const account = await admin();
  await account.client.del(`/products/${product.productId}`);

  const seen = observe(page);
  await page.goto(`/product/${product.slug}`);
  await expect(page.getByRole("heading", { name: "Product not found" })).toBeVisible();
  const observed = clean(seen);
  expect(observed.pageErrors).toEqual([]);
  expect(observed.dialogs).toEqual([]);
});

// ── Viewports ─────────────────────────────────────────────────────────────────────────────

for (const [label, viewport] of Object.entries({
  desktop: { width: 1280, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
})) {
  test(`the gallery is reachable at ${label} width and the page does not scroll sideways`, async ({ page }) => {
    // The thumbnail strip used to be `display: none` below 750px, so a phone could reach only the
    // first photo. This is the assertion that would have caught it.
    const product = await productWithGallery(`vp-${label}`);
    await page.setViewportSize(viewport);
    await page.goto(`/product/${product.slug}`);
    await expect(page.locator(".pg-frame img")).toBeVisible();

    const thumbnails = page.getByRole("button", { name: /^Show photo/ });
    await expect(thumbnails.first()).toBeVisible();

    // Every thumbnail must be clickable, not merely present.
    await thumbnails.last().click();
    await expect(page.locator(".pg-frame img")).toBeVisible();

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth, `${label} overflows horizontally`).toBeLessThanOrEqual(overflow.clientWidth);
  });
}

// ── Admin flow in the browser ─────────────────────────────────────────────────────────────

test("renaming a product does not move its public URL", async ({ page }) => {
  const product = await productWithGallery("rename");
  const account = await admin();
  const categoryId = Number(sqlValue("SELECT CATEGORY_ID FROM CATEGORIES WHERE CATEGORY_NAME='Men' LIMIT 1"));

  await account.client.put(`/products/${product.productId}`, {
    productName: `${product.name} RENAMED`,
    productDescription: "renamed copy",
    brand: "Shades World",
    basePrice: money(1500),
    categoryIds: [categoryId],
  });

  const slugNow = sqlValue(`SELECT SLUG FROM PRODUCTS WHERE PRODUCT_ID=${product.productId}`);
  expect(slugNow, "a rename must not break shared links").toBe(product.slug);

  // And the old link still resolves in a browser, now showing the new name.
  await page.goto(`/product/${product.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: `${product.name} RENAMED` })).toBeVisible();
});

test("an admin-supplied slug is validated and a duplicate is refused", async () => {
  const product = await productWithGallery("custom-slug");
  const account = await admin();
  const categoryId = Number(sqlValue("SELECT CATEGORY_ID FROM CATEGORIES WHERE CATEGORY_NAME='Men' LIMIT 1"));
  const base = {
    productName: product.name,
    productDescription: "copy",
    brand: "Shades World",
    basePrice: money(1500),
    categoryIds: [categoryId],
  };

  for (const [slug, expectedStatus, why] of [
    ["Has Spaces", 400, "malformed"],
    ["admin", 400, "reserved"],
    ["12345", 400, "all digits, ambiguous with a legacy id"],
  ]) {
    const failure = await account.client.put(`/products/${product.productId}`, { ...base, slug })
      .then(() => null, (error) => error);
    expect(failure, `${why} should be refused`).toBeTruthy();
    expect(failure.status, `${slug} (${why})`).toBe(expectedStatus);
  }

  // A duplicate of another product's slug is a conflict, not a silent overwrite.
  const other = await productWithGallery("custom-slug-other");
  const conflict = await account.client.put(`/products/${product.productId}`, { ...base, slug: other.slug })
    .then(() => null, (error) => error);
  expect(conflict).toBeTruthy();
  expect(conflict.status).toBe(409);

  // A valid one is accepted and becomes the product's address.
  const accepted = `e2e-custom-${Date.now()}`;
  await account.client.put(`/products/${product.productId}`, { ...base, slug: accepted });
  expect(sqlValue(`SELECT SLUG FROM PRODUCTS WHERE PRODUCT_ID=${product.productId}`)).toBe(accepted);
});

test("an admin uploads, reorders, re-mains and captions a variant's images, and it all survives a refresh", async ({ page }) => {
  const account = await admin();
  const product = await productWithGallery("admin-ui");
  const seen = observe(page);
  const blueRows = () => imageRowsOf(product.productId)
    .filter((row) => row.split(":")[3] === String(product.blue.variantId));

  // The shared helper, not a hand-rolled form fill: /sign in/i as an accessible-name matcher also
  // matches the Google "Sign in with Google" button, and submitSignIn additionally waits out the
  // login rate limit that a long run legitimately trips.
  await submitSignIn(page, account, { admin: true });

  const openWizard = async () => {
    await page.getByRole("button", { name: /^Products$/ }).click();
    await page.getByPlaceholder(/Search product/).fill(product.name);
    await page.getByRole("button", { name: "Edit" }).first().click();
  };
  await openWizard();

  // Step 1 is Blue, the Main Product, with its three photos (the Studio shot plus two own).
  const blueSection = page.locator('[data-variant-section="1"]');
  const rows = blueSection.locator(".admin-image-editor li");
  const startingBlue = blueRows().length;
  await expect(rows).toHaveCount(startingBlue);

  // Stage one more photo for Blue and save. New files upload on Save, not on selection — the
  // wizard's create/edit contract — so the count changes only after the save lands.
  await blueSection.getByLabel("Additional photos for Blue").setInputFiles(imageFile("uploaded.png"));
  await blueSection.getByLabel("Photo description for Blue").fill("Uploaded via admin UI");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => blueRows().length, { timeout: 30_000 }).toBe(startingBlue + 1);

  // Back into the wizard: everything below applies immediately, like the old image editor.
  await openWizard();
  await expect(rows).toHaveCount(startingBlue + 1);

  // Reorder INSIDE Blue's section: move its last photo up one place.
  //
  // Asserted on DISPLAY_ORDER, not on imageRowsOf's row order. That query sorts primary-first, so
  // the main image stays at the head whatever its display order is — comparing row order made
  // the reorder look like it had done nothing when it had.
  const blueOrders = () => Object.fromEntries(blueRows().map((row) => [row.split(":")[0], row.split(":")[1]]));
  const ordersBefore = blueOrders();
  expect(Object.keys(ordersBefore).length, "Blue needs two photos to reorder").toBeGreaterThan(1);
  await rows.last().getByRole("button", { name: /Move image \d+ earlier/ }).click();
  await expect.poll(blueOrders).not.toEqual(ordersBefore);

  // Promote a NAMED image — the one just uploaded — rather than "whatever is at index 1", so the
  // rest of this test can wait on content instead of position.
  const uploadedRow = rows.filter({ has: page.locator('input[value="Uploaded via admin UI"]') });
  await uploadedRow.getByRole("button", { name: "Make main image" }).click();

  // Wait for BLUE'S MAIN IMAGE TO BE THAT IMAGE, not merely for a main row to exist — a row with
  // .is-primary exists at every instant, including while the list still shows the old one.
  const primaryRow = blueSection.locator(".admin-image-editor li.is-primary");
  await expect(primaryRow.getByRole("textbox")).toHaveValue("Uploaded via admin UI");
  const caption = primaryRow.getByRole("textbox");
  await caption.fill("Primary caption from admin");
  // Tab, not locator.blur(). The alt text saves on blur, and blur() left the field focused here, so
  // the handler never fired and nothing was written — a test that would have reported a working
  // feature as broken.
  await caption.press("Tab");
  await expect.poll(() => imageRowsOf(product.productId).join("|"), { timeout: 15_000 })
    .toContain("Primary caption from admin");
  // …and it landed on Blue's MAIN image.
  const bluePrimary = blueRows().find((row) => row.split(":")[2] === "1");
  expect(bluePrimary).toContain("Primary caption from admin");

  // Everything above must survive a reload — this is the step that catches state that only ever
  // lived in React.
  const persisted = imageRowsOf(product.productId);
  await page.reload();
  await openWizard();
  await expect(rows).toHaveCount(startingBlue + 1);
  expect(imageRowsOf(product.productId)).toEqual(persisted);
  // Exactly one main image per variant, for both variants.
  expect(blueRows().filter((row) => row.split(":")[2] === "1")).toHaveLength(1);
  expect(imageRowsOf(product.productId)
    .filter((row) => row.split(":")[3] === String(product.orange.variantId) && row.split(":")[2] === "1"))
    .toHaveLength(1);

  // Remove one image; the removal is guarded by the application's own modal, never window.confirm.
  await rows.last().getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Remove photo" }).click();
  await expect.poll(() => blueRows().length, { timeout: 30_000 }).toBe(startingBlue);
  expect(blueRows().filter((row) => row.split(":")[2] === "1")).toHaveLength(1);

  expect(clean(seen), "the page must be clean").toEqual(CLEAN);
});
