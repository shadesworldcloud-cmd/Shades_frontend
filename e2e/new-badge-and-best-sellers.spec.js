const { test, expect } = require("@playwright/test");
const { admin, createProduct, markDelivered } = require("./support/fixtures");
const { sql, sqlValue } = require("./support/api");
const { signInAsNewCustomer } = require("./support/ui");
const { addToBag, checkout } = require("./support/shop");

// Two features, one spec because they share expensive fixtures (a signed-in buyer and real orders).
//
// The New badge used to be computed in the browser as
//   Date.now() - new Date(product.createdAt) < 30 * 86400000
// — client clock, zone-less timestamp parsed as browser-local, hard-coded window, and measured
// from row creation rather than publication. It is now one server value, ProductResponse.isNew,
// decided by NewProductPolicy against PRODUCTS.PUBLISHED_AT in UTC.
//
// Best Sellers is a real aggregate over paid orders minus returns; see
// ProductRepository.findBestSellers.

const bestSellers = (page, limit = 20) => page.evaluate(async (max) => {
  const res = await fetch(`${window.location.origin.replace("3001", "8081")}/api/products/best-sellers?limit=${max}`);
  return (await res.json()).map((entry) => ({ productId: entry.product.productId, sold: entry.soldQuantity }));
}, limit);

const badgeOn = (page, selector) => page.evaluate((sel) => {
  const card = document.querySelector(sel);
  return Boolean(card && card.querySelector(".new-badge, .pd-badge"));
}, selector);

// ── The New badge ────────────────────────────────────────────────────────────────────────────

test("a freshly published product carries the badge, and an old one does not", async ({ page }) => {
  const fresh = await createProduct({
    name: `E2E Badge Fresh ${Date.now()}`,
    variants: [{ sku: `NB-F-${Date.now()}`, variantName: "Slate", color: "Slate", price: 1500, quantityAvailable: 5 }],
  });
  const old = await createProduct({
    name: `E2E Badge Old ${Date.now()}`,
    variants: [{ sku: `NB-O-${Date.now()}`, variantName: "Sand", color: "Sand", price: 1500, quantityAvailable: 5 }],
  });
  // Age the second one by moving its publication date, which is the only input to the rule.
  sql(`UPDATE PRODUCTS SET PUBLISHED_AT = UTC_TIMESTAMP() - INTERVAL 40 DAY WHERE PRODUCT_ID = ${old.productId}`);

  const flags = await page.goto("/").then(() => page.evaluate(async (ids) => {
    const read = async (id) => {
      const res = await fetch(`${window.location.origin.replace("3001", "8081")}/api/products/${id}`);
      return (await res.json()).isNew;
    };
    return { fresh: await read(ids.fresh), old: await read(ids.old) };
  }, { fresh: fresh.productId, old: old.productId }));

  expect(flags.fresh, "published moments ago").toBe(true);
  expect(flags.old, "published 40 days ago, outside the 30-day window").toBe(false);

  // And the badge is the same on every surface, because they all read the same server value.
  await page.goto(`/product/${fresh.productId}`);
  await page.waitForLoadState("networkidle");
  // .pg-frame, not .pd-main-image: the product page's ad-hoc image block was replaced by the
  // ProductGallery component, which renders the badge inside its own frame. The badge itself is
  // unchanged — still .pd-badge, still driven by the server's isNew.
  expect(await badgeOn(page, ".pg-frame"), "product detail").toBe(true);

  for (const route of [`/shop?q=${encodeURIComponent(fresh.name)}`, `/?q=${encodeURIComponent(fresh.name)}`]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    expect(await badgeOn(page, ".product-card"), `listing at ${route}`).toBe(true);
  }
  await page.goto(`/shop?q=${encodeURIComponent(old.name)}`);
  await page.waitForLoadState("networkidle");
  expect(await badgeOn(page, ".product-card"), "an old product shows no badge").toBe(false);
});

test("the badge sits exactly on the configured boundary and is not moved by an edit", async ({ page }) => {
  const product = await createProduct({
    name: `E2E Badge Boundary ${Date.now()}`,
    variants: [{ sku: `NB-B-${Date.now()}`, variantName: "Ink", color: "Ink", price: 1500, quantityAvailable: 5 }],
  });
  const isNew = async () => {
    await page.goto("/");
    return page.evaluate(async (id) => {
      const res = await fetch(`${window.location.origin.replace("3001", "8081")}/api/products/${id}`);
      return (await res.json()).isNew;
    }, product.productId);
  };

  // Just inside 30 days.
  sql(`UPDATE PRODUCTS SET PUBLISHED_AT = UTC_TIMESTAMP() - INTERVAL 30 DAY + INTERVAL 2 MINUTE WHERE PRODUCT_ID = ${product.productId}`);
  expect(await isNew(), "29d 23h 58m old is still New").toBe(true);

  // Just outside. The boundary is exclusive: at exactly 30 days the badge is gone.
  sql(`UPDATE PRODUCTS SET PUBLISHED_AT = UTC_TIMESTAMP() - INTERVAL 30 DAY - INTERVAL 2 MINUTE WHERE PRODUCT_ID = ${product.productId}`);
  expect(await isNew(), "30d 0h 2m old is not New").toBe(false);

  // Editing the product must not resurrect the badge. This is why the rule cannot use UPDATED_AT.
  const account = await admin();
  await account.client.put(`/products/${product.productId}`, {
    productName: `${product.name} edited`, productDescription: "Edited copy", brand: "Shades World",
    basePrice: 1600, categoryIds: [Number(sqlValue("SELECT CATEGORY_ID FROM CATEGORIES WHERE CATEGORY_NAME='Men' LIMIT 1"))],
    attributes: {},
  });
  expect(await isNew(), "an edit must not make an old product New again").toBe(false);
  expect(Number(sqlValue(
    `SELECT UPDATED_AT > PUBLISHED_AT FROM PRODUCTS WHERE PRODUCT_ID = ${product.productId}`
  )), "the edit did move UPDATED_AT — publication stayed put").toBe(1);
});

test("an unpublished product is neither badged nor publicly listed", async ({ page }) => {
  const draft = await createProduct({
    name: `E2E Badge Draft ${Date.now()}`,
    variants: [{ sku: `NB-D-${Date.now()}`, variantName: "Fog", color: "Fog", price: 1500, quantityAvailable: 5 }],
  });
  // Deactivate and clear publication, i.e. a product that never went on sale.
  const account = await admin();
  // `active` is a query parameter on this endpoint, not a body field.
  await account.client.patch(`/products/${draft.productId}/active?active=false`);
  sql(`UPDATE PRODUCTS SET PUBLISHED_AT = NULL WHERE PRODUCT_ID = ${draft.productId}`);

  await page.goto(`/shop?q=${encodeURIComponent(draft.name)}`);
  await page.waitForLoadState("networkidle");
  expect(await page.locator(".product-card").count(), "a draft must not leak into public listings").toBe(0);

  const flag = await page.evaluate(async (id) => {
    const res = await fetch(`${window.location.origin.replace("3001", "8081")}/api/products/${id}`);
    return (await res.json()).isNew;
  }, draft.productId);
  expect(flag, "an unpublished product can never be New").toBe(false);
});

test("the badge is identical whatever timezone the customer is in", async ({ browser }) => {
  // The point of moving this rule to the server. The old client-side calculation compared
  // Date.now() against a zone-less timestamp parsed as browser-local, so two customers 25 hours
  // apart could see different badges on the same product. Kiritimati (+14) and Midway (-11) are
  // the extremes; a product sitting half an hour either side of the boundary is where a
  // clock-dependent rule gives itself away.
  const stamp = Date.now();
  const product = await createProduct({
    name: `E2E Badge Zones ${stamp}`,
    variants: [{ sku: `NB-Z-${stamp}`, variantName: "Zone", color: "Zone", price: 1500, quantityAvailable: 5 }],
  });
  const ZONES = ["UTC", "Asia/Kolkata", "Pacific/Kiritimati", "Pacific/Midway"];

  const badgeAcrossZones = async () => {
    const seen = {};
    for (const timezoneId of ZONES) {
      const context = await browser.newContext({ timezoneId });
      const page = await context.newPage();
      await page.goto(`/product/${product.productId}`);
      await page.waitForLoadState("networkidle");
      seen[timezoneId] = await page.locator(".pd-badge").count();
      await context.close();
    }
    return seen;
  };

  sql(`UPDATE PRODUCTS SET PUBLISHED_AT = UTC_TIMESTAMP() - INTERVAL 30 DAY + INTERVAL 30 MINUTE WHERE PRODUCT_ID = ${product.productId}`);
  const inside = await badgeAcrossZones();
  expect(Object.values(inside), `just inside the window, every zone must show the badge: ${JSON.stringify(inside)}`)
    .toEqual(ZONES.map(() => 1));

  sql(`UPDATE PRODUCTS SET PUBLISHED_AT = UTC_TIMESTAMP() - INTERVAL 30 DAY - INTERVAL 30 MINUTE WHERE PRODUCT_ID = ${product.productId}`);
  const outside = await badgeAcrossZones();
  expect(Object.values(outside), `just outside the window, no zone may show it: ${JSON.stringify(outside)}`)
    .toEqual(ZONES.map(() => 0));
});

// ── Best Sellers ─────────────────────────────────────────────────────────────────────────────

/**
 * Net sold quantity for one product, computed straight from the database by an independent
 * restatement of the rules. Used to check the aggregate against something other than itself, and
 * unaffected by where the product happens to land in the ranking — the API is capped at 50 rows, so
 * an assertion that reads the ranking can only ever see products near the top.
 */
const netSoldFromDatabase = (productId) => Number(sqlValue(`
  SELECT COALESCE(SUM(GREATEST(oi.QUANTITY - COALESCE(ret.q, 0), 0)), 0)
  FROM ORDER_ITEMS oi
  JOIN ORDERS o ON o.ORDER_ID = oi.ORDER_ID
  JOIN PRODUCT_VARIANTS v ON v.VARIANT_ID = oi.VARIANT_ID
  LEFT JOIN (SELECT ri.ORDER_ITEM_ID AS id, SUM(ri.QUANTITY) AS q FROM RETURN_ITEMS ri
             JOIN RETURNS r ON r.RETURN_ID = ri.RETURN_ID
             WHERE r.RETURN_STATUS IN ('RECEIVED','COMPLETED') GROUP BY ri.ORDER_ITEM_ID) ret
         ON ret.id = oi.ORDER_ITEM_ID
  WHERE v.PRODUCT_ID = ${Number(productId)}
    AND o.ORDER_STATUS <> 'CANCELLED'
    AND EXISTS (SELECT 1 FROM PAYMENTS p WHERE p.ORDER_ID = o.ORDER_ID
                AND p.PAYMENT_STATUS IN ('PAID','PARTIALLY_REFUNDED'))`));

test("the ranking counts paid orders, ignores cancelled ones and survives a duplicate callback", async ({ page }) => {
  const stamp = Date.now();
  const top = await createProduct({
    name: `E2E BS Top ${stamp}`,
    variants: [{ sku: `BS-T-${stamp}`, variantName: "Top", color: "Top", price: 1000, quantityAvailable: 50 }],
  });
  const runnerUp = await createProduct({
    name: `E2E BS Runner ${stamp}`,
    variants: [{ sku: `BS-R-${stamp}`, variantName: "Runner", color: "Runner", price: 1000, quantityAvailable: 50 }],
  });
  const cancelled = await createProduct({
    name: `E2E BS Cancelled ${stamp}`,
    variants: [{ sku: `BS-C-${stamp}`, variantName: "Gone", color: "Gone", price: 1000, quantityAvailable: 50 }],
  });

  const account = await signInAsNewCustomer(page, "bs");
  // 40, not a small number: the ranking endpoint caps at its top 50, and ECOMMERCE_TEST_DB
  // accumulates sold products across E2E runs. The retained quantity after the partial return
  // below (40 - 15 = 25) has to keep this product inside that window, or the final assertion
  // reads "missing from the ranking" when the maths it is checking was actually right.
  await addToBag(page, { productId: top.productId, quantity: 40, expectedBadge: 40 });
  const topOrder = await checkout(page, { account });
  await addToBag(page, { productId: runnerUp.productId, quantity: 8, expectedBadge: 8 });
  await checkout(page, { account });
  await addToBag(page, { productId: cancelled.productId, quantity: 9, expectedBadge: 9 });
  const cancelledOrder = await checkout(page, { account });

  // An abandoned/cancelled order must not count. This is the state expireUnpaidOrder leaves too.
  sql(`UPDATE ORDERS SET ORDER_STATUS='CANCELLED' WHERE ORDER_ID=${cancelledOrder}`);

  const ranked = await bestSellers(page, 50);
  const soldFor = (id) => ranked.find((row) => row.productId === id)?.sold;
  expect(soldFor(top.productId), "40 paid units").toBe(40);
  expect(soldFor(runnerUp.productId), "8 paid units").toBe(8);
  expect(soldFor(cancelled.productId), "a cancelled order contributes nothing").toBeUndefined();
  expect(ranked.findIndex((row) => row.productId === top.productId))
    .toBeLessThan(ranked.findIndex((row) => row.productId === runnerUp.productId));

  // A retried payment callback leaves a second PAID row. The aggregate reaches PAYMENTS through
  // EXISTS precisely so this cannot multiply the order's contribution.
  sql(`INSERT INTO PAYMENTS (ORDER_ID, AMOUNT, PAYMENT_METHOD, PAYMENT_STATUS, PAYMENT_PROVIDER, CREATED_AT, PAID_AT)
       SELECT ORDER_ID, AMOUNT, PAYMENT_METHOD, 'PAID', PAYMENT_PROVIDER, CREATED_AT, PAID_AT
       FROM PAYMENTS WHERE ORDER_ID=${topOrder} LIMIT 1`);
  expect(Number(sqlValue(`SELECT COUNT(*) FROM PAYMENTS WHERE ORDER_ID=${topOrder}`)),
    "the duplicate really is there").toBeGreaterThan(1);
  expect((await bestSellers(page, 50)).find((row) => row.productId === top.productId)?.sold,
    "a duplicated payment callback must not inflate sales").toBe(40);

  // A partial return reduces the retained quantity by exactly what came back.
  expect(await markDelivered(topOrder)).toBe("DELIVERED");
  const orderItemId = sqlValue(`SELECT ORDER_ITEM_ID FROM ORDER_ITEMS WHERE ORDER_ID=${topOrder} LIMIT 1`);
  sql(`INSERT INTO RETURNS (ORDER_ID, USER_ID, RETURN_STATUS, RETURN_REASON, REQUESTED_AT)
       VALUES (${topOrder}, ${account.userId}, 'RECEIVED', 'E2E partial return', UTC_TIMESTAMP())`);
  const returnId = sqlValue(`SELECT MAX(RETURN_ID) FROM RETURNS WHERE ORDER_ID=${topOrder}`);
  sql(`INSERT INTO RETURN_ITEMS (RETURN_ID, ORDER_ITEM_ID, QUANTITY) VALUES (${returnId}, ${orderItemId}, 15)`);

  expect((await bestSellers(page, 50)).find((row) => row.productId === top.productId)?.sold,
    "15 of 40 units came back, so 25 retained units still count").toBe(25);
  // Cross-checked against the database by an independent restatement of the same rules, so the
  // aggregate is not merely being compared with itself.
  expect(netSoldFromDatabase(top.productId), "API and database must agree on net units sold").toBe(25);

  // And a full return removes the product from the ranking entirely.
  sql(`UPDATE RETURN_ITEMS SET QUANTITY = 40 WHERE RETURN_ID = ${returnId}`);
  expect((await bestSellers(page, 50)).find((row) => row.productId === top.productId),
    "a fully returned sale is not a sale").toBeUndefined();
});

/**
 * How many units a brand-new product must sell to be inside the public ranking window at all.
 *
 * ProductServiceImpl clamps the endpoint's `limit` to MAX_BEST_SELLERS = 50, so a product ranked
 * 51st is invisible to this API at *every* requested limit — asking for more rows cannot help.
 * ECOMMERCE_TEST_DB accumulates products and paid orders across every run (383 products were
 * eligible when this was written), and the fixture below used to sell a fixed two units and then
 * look for the product in the top 50. That expired: two units tied with the 50th place on quantity,
 * lost the revenue tiebreak, and landed the product at rank 51 — a correct application failing a
 * test whose premise had quietly stopped holding.
 *
 * Selling strictly more than the 50th place's quantity makes the position deterministic instead of
 * merely likely: at most 49 rows can exceed row 50's quantity, so however the ties below it fall,
 * the product's rank is at most 50. The eligibility rules are restated here for the same reason
 * netSoldFromDatabase restates them — the API cannot show us row 50 while we are the row being
 * pushed out of it.
 */
const unitsToEnterRanking = () => Number(sqlValue(`
  SELECT COALESCE(MIN(netQty), 0) + 1 FROM (
    SELECT SUM(GREATEST(oi.QUANTITY - COALESCE(ret.q, 0), 0)) AS netQty
    FROM ORDER_ITEMS oi
    JOIN ORDERS o ON o.ORDER_ID = oi.ORDER_ID
    JOIN PRODUCT_VARIANTS v ON v.VARIANT_ID = oi.VARIANT_ID
    JOIN PRODUCTS p ON p.PRODUCT_ID = v.PRODUCT_ID
    LEFT JOIN (SELECT ri.ORDER_ITEM_ID AS id, SUM(ri.QUANTITY) AS q FROM RETURN_ITEMS ri
               JOIN RETURNS r ON r.RETURN_ID = ri.RETURN_ID
               WHERE r.RETURN_STATUS IN ('RECEIVED','COMPLETED') GROUP BY ri.ORDER_ITEM_ID) ret
           ON ret.id = oi.ORDER_ITEM_ID
    WHERE o.ORDER_STATUS <> 'CANCELLED'
      AND p.IS_ACTIVE = 1 AND p.PUBLISHED_AT IS NOT NULL
      AND EXISTS (SELECT 1 FROM PAYMENTS pay WHERE pay.ORDER_ID = o.ORDER_ID
                  AND pay.PAYMENT_STATUS IN ('PAID','PARTIALLY_REFUNDED'))
      AND EXISTS (SELECT 1 FROM PRODUCT_VARIANTS av WHERE av.PRODUCT_ID = p.PRODUCT_ID
                  AND av.IS_ACTIVE = 1 AND av.QUANTITY_AVAILABLE > 0)
    GROUP BY v.PRODUCT_ID
    HAVING netQty > 0
    ORDER BY netQty DESC
    LIMIT 50
  ) ranking`));

test("a product with no stock left drops out of the public ranking", async ({ page }) => {
  const stamp = Date.now();
  const units = unitsToEnterRanking();
  const product = await createProduct({
    name: `E2E BS Stockout ${stamp}`,
    // Stock above what is bought, so the product is genuinely in stock for the first assertion —
    // being in the ranking *before* the stockout is half of what this test proves.
    variants: [{ sku: `BS-S-${stamp}`, variantName: "Last", color: "Last", price: 1000, quantityAvailable: units + 5 }],
  });
  const account = await signInAsNewCustomer(page, "bsstock");
  await addToBag(page, { productId: product.productId, quantity: units, expectedBadge: units });
  await checkout(page, { account });

  expect((await bestSellers(page, 50)).some((row) => row.productId === product.productId),
    `${units} net units should place a new product inside the 50-row window`).toBe(true);
  sql(`UPDATE PRODUCT_VARIANTS SET QUANTITY_AVAILABLE = 0 WHERE PRODUCT_ID = ${product.productId}`);
  expect((await bestSellers(page, 50)).some((row) => row.productId === product.productId),
    "a completely out-of-stock product is not offered as a best seller").toBe(false);
});

test("the homepage section sits above the category controls and pages five at a time", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const section = page.locator(".best-sellers");
  await expect(section).toBeVisible();
  await expect(page.locator("#best-sellers-heading")).toHaveText("Best Sellers");
  expect(await page.evaluate(() => {
    const bs = document.querySelector(".best-sellers");
    const strip = document.querySelector(".category-strip");
    return Boolean(bs.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING);
  }), "the section must sit immediately above All/Men/Women/Unisex/Accessory").toBe(true);

  const cards = page.locator(".best-sellers-row .product-card");
  await expect(cards).toHaveCount(5);

  const previous = page.locator('.best-sellers-arrows button[aria-label="Show previous best sellers"]');
  const next = page.locator('.best-sellers-arrows button[aria-label="Show next best sellers"]');
  await expect(previous, "Previous is disabled on the first group").toBeDisabled();

  const firstGroup = await cards.allTextContents();
  await next.click();
  await expect(previous).toBeEnabled();
  const secondGroup = await cards.allTextContents();
  expect(secondGroup, "Next moves to a different group").not.toEqual(firstGroup);

  await previous.click();
  expect(await cards.allTextContents(), "Previous returns to the original group").toEqual(firstGroup);

  // Keyboard reachable with a visible focus ring.
  await next.focus();
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")))
    .toBe("Show next best sellers");
});

test("the section is responsive and never clips", async ({ page }) => {
  for (const [width, expected] of [[1280, 5], [768, 3], [375, 1]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".best-sellers-row .product-card"), `${width}px shows ${expected} cards`)
      .toHaveCount(expected);
    const overflow = await page.evaluate(() => {
      const row = document.querySelector(".best-sellers-row");
      return { doc: document.documentElement.scrollWidth, vp: document.documentElement.clientWidth,
        rowRight: Math.round(row.getBoundingClientRect().right) };
    });
    expect(overflow.doc, `no horizontal scroll at ${width}px`).toBeLessThanOrEqual(overflow.vp + 1);
    expect(overflow.rowRight).toBeLessThanOrEqual(overflow.vp + 1);
  }
});
