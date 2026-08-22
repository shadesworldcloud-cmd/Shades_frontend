const { test, expect } = require("@playwright/test");
const { ApiClient, sql, sqlValue } = require("./support/api");
const {
  admin, clearAutomaticOffers, createProduct, lineDiscountsOf, markDelivered, offerSnapshotOf,
  withAutomaticOffer,
} = require("./support/fixtures");
const { signInAsNewCustomer } = require("./support/ui");
const { addToBag, checkout } = require("./support/shop");

// The automatic quantity offer, priced by the real backend against the real MySQL schema.
//
// Nothing is mocked. The quantity matrix goes through POST /api/offers/automatic/quote — a public
// endpoint, so it needs no account and costs no register budget — and the full lifecycle
// (cart → checkout → payment → persisted order → refund) goes through the browser exactly once,
// because that is the expensive part and one traversal proves the wiring the matrix cannot.
//
// The offer under test is always "N units for ₹X", configured per test. Nothing here assumes ₹500 or
// a group of two except the cases that exist to pin the brief's worked example.

const OFFER_UNIT_PRICE = 1000;

// An offer left live would discount every later spec's cart, and the specs that assert exact
// checkout totals run after these alphabetically — so a leftover offer would fail them with a wrong
// total rather than with whatever they were testing. afterAll runs even when a test above has
// failed, which is exactly when the leftover would otherwise be worst.
test.afterAll(() => { clearAutomaticOffers(); });

/** Prices a cart through the real endpoint. Server-side fetch, so no CORS and no session needed. */
const quote = async (lines, options = {}) => {
  const client = new ApiClient();
  const query = options.couponCode ? `?couponCode=${encodeURIComponent(options.couponCode)}` : "";
  return client.post(`/offers/automatic/quote${query}`, { lines });
};

let sharedProduct;

/** One product with plenty of stock, reused by every quote-only test in this file. */
const product = async () => {
  if (!sharedProduct) {
    const stamp = Date.now();
    sharedProduct = await createProduct({
      name: `E2E Offer Base ${stamp}`,
      variants: [{ sku: `AO-B-${stamp}`, variantName: "Base", color: "Base", price: OFFER_UNIT_PRICE, quantityAvailable: 400 }],
    });
  }
  return sharedProduct;
};

// ── The mandated quantity matrix, end to end ────────────────────────────────────────────────

test("the quantity matrix is priced by the server: 0,1,2,3,4,7,10 units of a 2-for-₹500 offer", async () => {
  await withAutomaticOffer({ offerName: "E2E Matrix Pair Offer", requiredQuantity: 2, discountPerGroup: 500 });
  const base = await product();
  const variantId = base.variants[0].variantId;

  const expected = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 1, 500],
    [3, 1, 500],
    [4, 2, 1000],
    [7, 3, 1500],
    [10, 5, 2500],
  ];

  for (const [units, groups, discount] of expected) {
    const priced = await quote(units === 0 ? [] : [{ variantId, quantity: units }]);
    expect(Number(priced.discount), `${units} units → discount`).toBe(discount);
    expect(Number(priced.subtotal), `${units} units → subtotal`).toBe(units * OFFER_UNIT_PRICE);
    if (units === 0) {
      // An empty cart has no offer block at all rather than a zeroed one: there is nothing to
      // explain, and a "0 groups" line on an empty bag reads like a failure.
      expect(priced.automaticOffer?.completeGroups ?? 0, "empty cart").toBe(0);
    } else {
      expect(priced.automaticOffer.completeGroups, `${units} units → groups`).toBe(groups);
      expect(priced.automaticOffer.eligibleQuantity, `${units} units → eligible units`).toBe(units);
    }
    // Prices are tax-inclusive: the discounted merchandise figure IS what the customer pays, and
    // GST is extracted from it rather than added to it. The whole point of pricing on the server is
    // that these three agree, so all three are restated here independently of it.
    const gross = units * OFFER_UNIT_PRICE - discount;
    const net = Number((gross / 1.18).toFixed(2));
    const shipping = units * OFFER_UNIT_PRICE >= 500 || units === 0 ? 0 : 49;
    expect(Number(priced.taxableAmount), `${units} units → net of GST`).toBeCloseTo(net, 2);
    expect(Number(priced.taxAmount), `${units} units → GST inside the price`)
      .toBeCloseTo(Number((gross - net).toFixed(2)), 2);
    // The invoice invariant, checked on the quote: net + GST must be the merchandise amount.
    expect(Number(priced.taxableAmount) + Number(priced.taxAmount), `${units} units → foots`)
      .toBeCloseTo(gross, 2);
    expect(Number(priced.totalAmount), `${units} units → total`).toBeCloseTo(gross + shipping, 2);
  }
});

test("cart-line splitting and merging cannot change the discount", async () => {
  await withAutomaticOffer({ offerName: "E2E Split Invariance", requiredQuantity: 2, discountPerGroup: 500 });
  const stamp = Date.now();
  // Seven distinct products, one unit each — the brief's other shape for the same seven units.
  const singles = [];
  for (let index = 0; index < 7; index += 1) {
    singles.push(await createProduct({
      name: `E2E Offer Single ${stamp}-${index}`,
      variants: [{ sku: `AO-S-${stamp}-${index}`, variantName: "One", color: "One", price: OFFER_UNIT_PRICE, quantityAvailable: 5 }],
    }));
  }

  const base = await product();
  const oneLineOfSeven = await quote([{ variantId: base.variants[0].variantId, quantity: 7 }]);
  const sevenLinesOfOne = await quote(singles.map((single) => ({
    variantId: single.variants[0].variantId, quantity: 1,
  })));

  expect(Number(sevenLinesOfOne.discount), "seven single lines").toBe(1500);
  expect(Number(sevenLinesOfOne.discount)).toBe(Number(oneLineOfSeven.discount));
  expect(sevenLinesOfOne.automaticOffer.completeGroups).toBe(oneLineOfSeven.automaticOffer.completeGroups);

  // And the same units sent as two lines rather than one.
  const asTwoLines = await quote([
    { variantId: base.variants[0].variantId, quantity: 4 },
    { variantId: singles[0].variants[0].variantId, quantity: 3 },
  ]);
  expect(Number(asTwoLines.discount), "four plus three").toBe(1500);
});

test("mixed variants of one product share groups, and a duplicated line is merged not double-counted", async () => {
  await withAutomaticOffer({ offerName: "E2E Variant Aggregation", requiredQuantity: 2, discountPerGroup: 500 });
  const stamp = Date.now();
  const multi = await createProduct({
    name: `E2E Offer Variants ${stamp}`,
    variants: [
      { sku: `AO-V1-${stamp}`, variantName: "Ink", color: "Ink", price: OFFER_UNIT_PRICE, quantityAvailable: 20 },
      { sku: `AO-V2-${stamp}`, variantName: "Sand", color: "Sand", price: OFFER_UNIT_PRICE, quantityAvailable: 20 },
    ],
  });

  const acrossVariants = await quote([
    { variantId: multi.variants[0].variantId, quantity: 1 },
    { variantId: multi.variants[1].variantId, quantity: 1 },
  ]);
  expect(acrossVariants.automaticOffer.completeGroups, "one unit of each colour is still a pair").toBe(1);
  expect(Number(acrossVariants.discount)).toBe(500);

  // A client that repeats a variant must get the same answer as one that sums it.
  const repeated = await quote([
    { variantId: multi.variants[0].variantId, quantity: 1 },
    { variantId: multi.variants[0].variantId, quantity: 1 },
  ]);
  expect(repeated.automaticOffer.eligibleQuantity, "duplicate lines are merged").toBe(2);
  expect(Number(repeated.discount)).toBe(500);
});

// ── Scope, caps and configuration ───────────────────────────────────────────────────────────

test("a product-scoped offer ignores units it does not cover", async () => {
  const stamp = Date.now();
  const covered = await createProduct({
    name: `E2E Offer Covered ${stamp}`,
    variants: [{ sku: `AO-C-${stamp}`, variantName: "In", color: "In", price: OFFER_UNIT_PRICE, quantityAvailable: 20 }],
  });
  const excluded = await createProduct({
    name: `E2E Offer Excluded ${stamp}`,
    variants: [{ sku: `AO-X-${stamp}`, variantName: "Out", color: "Out", price: OFFER_UNIT_PRICE, quantityAvailable: 20 }],
  });
  await withAutomaticOffer({
    offerName: "E2E Scoped Offer", requiredQuantity: 2, discountPerGroup: 500,
    scopeType: "SELECTED_PRODUCTS", productIds: [covered.productId],
  });

  const priced = await quote([
    { variantId: covered.variants[0].variantId, quantity: 3 },
    { variantId: excluded.variants[0].variantId, quantity: 5 },
  ]);

  expect(priced.automaticOffer.eligibleQuantity, "only the covered product counts").toBe(3);
  expect(priced.automaticOffer.completeGroups).toBe(1);
  expect(Number(priced.discount)).toBe(500);
  expect(priced.automaticOffer.eligibleVariantIds).toEqual([covered.variants[0].variantId]);
  expect(Number(priced.subtotal), "the excluded units are still charged for").toBe(8 * OFFER_UNIT_PRICE);
});

test("the discount is capped at the eligible merchandise subtotal and never funded by other items", async () => {
  const stamp = Date.now();
  const cheap = await createProduct({
    name: `E2E Offer Cheap ${stamp}`,
    variants: [{ sku: `AO-CH-${stamp}`, variantName: "Cheap", color: "Cheap", price: 100, quantityAvailable: 20 }],
  });
  const dear = await createProduct({
    name: `E2E Offer Dear ${stamp}`,
    variants: [{ sku: `AO-D-${stamp}`, variantName: "Dear", color: "Dear", price: 3000, quantityAvailable: 20 }],
  });
  await withAutomaticOffer({
    offerName: "E2E Capped Offer", requiredQuantity: 2, discountPerGroup: 500,
    scopeType: "SELECTED_PRODUCTS", productIds: [cheap.productId],
  });

  // Four ₹100 units earn two groups (₹1,000) but are only worth ₹400.
  const priced = await quote([
    { variantId: cheap.variants[0].variantId, quantity: 4 },
    { variantId: dear.variants[0].variantId, quantity: 3 },
  ]);

  expect(Number(priced.discount), "capped at the eligible value, not the cart value").toBe(400);
  expect(Number(priced.automaticOffer.eligibleSubtotal)).toBe(400);
  expect(Number(priced.taxableAmount)).toBe(400 + 9000 - 400);
  expect(Number(priced.totalAmount)).toBeGreaterThan(0);
});

test("a minimum subtotal withholds the discount while still reporting progress", async () => {
  const base = await product();
  await withAutomaticOffer({
    offerName: "E2E Minimum Offer", requiredQuantity: 2, discountPerGroup: 500,
    minimumOrderSubtotal: 5000,
  });

  const below = await quote([{ variantId: base.variants[0].variantId, quantity: 2 }]);
  expect(Number(below.discount), "₹2,000 of eligible items is below the ₹5,000 minimum").toBe(0);
  expect(below.automaticOffer.eligibleQuantity, "the units are still reported").toBe(2);
  expect(below.automaticOffer.progressMessage, "the shopper is told what unlocks it").toMatch(/more of eligible items/i);

  const atMinimum = await quote([{ variantId: base.variants[0].variantId, quantity: 5 }]);
  expect(Number(atMinimum.discount), "₹5,000 meets the minimum, two complete pairs").toBe(1000);
});

test("the quote explains why no discount applied, in every rejection case", async () => {
  const base = await product();
  const variantId = base.variants[0].variantId;
  const lines = [{ variantId, quantity: 4 }];

  // Nothing configured at all.
  clearAutomaticOffers();
  expect((await quote(lines)).diagnostic, "no offer configured")
    .toMatch(/No automatic offer is currently active/i);

  // Live, but the bag has not reached a complete group.
  await withAutomaticOffer({ offerName: "E2E Diagnostic Offer", requiredQuantity: 5, discountPerGroup: 500 });
  const short = await quote([{ variantId, quantity: 2 }]);
  expect(Number(short.discount)).toBe(0);
  expect(short.diagnostic, "not enough eligible units").toMatch(/holds 2 eligible units and a complete group needs 5/i);

  // Live, but scheduled to start later.
  await withAutomaticOffer({
    offerName: "E2E Future Diagnostic", startMinutes: 120, endMinutes: 60 * 24,
  });
  expect((await quote(lines)).diagnostic, "scheduled").toMatch(/scheduled to start at/i);

  // Live, but nothing in the bag is in scope.
  const other = await createProduct({
    name: `E2E Diag Scope ${Date.now()}`,
    variants: [{ sku: `AO-DS-${Date.now()}`, variantName: "S", color: "S", price: 500, quantityAvailable: 10 }],
  });
  await withAutomaticOffer({
    offerName: "E2E Scoped Diagnostic", scopeType: "SELECTED_PRODUCTS", productIds: [other.productId],
  });
  expect((await quote(lines)).diagnostic, "out of scope")
    .toMatch(/nothing in this bag is within its eligibility scope \(SELECTED_PRODUCTS\)/i);

  // Live, in scope, but below the minimum subtotal.
  await withAutomaticOffer({ offerName: "E2E Minimum Diagnostic", minimumOrderSubtotal: 999999 });
  expect((await quote(lines)).diagnostic, "below minimum").toMatch(/needs a minimum eligible subtotal of/i);

  // And when it does apply there is nothing to explain.
  await withAutomaticOffer({ offerName: "E2E Applying Diagnostic", requiredQuantity: 2, discountPerGroup: 500 });
  const applied = await quote(lines);
  expect(Number(applied.discount)).toBe(1000);
  expect(applied.diagnostic, "a working offer needs no explanation").toBeNull();
});

test("a group size other than two behaves the same way", async () => {
  const base = await product();
  await withAutomaticOffer({ offerName: "E2E Three For Offer", requiredQuantity: 3, discountPerGroup: 250 });

  for (const [units, discount] of [[2, 0], [3, 250], [5, 250], [6, 500], [10, 750]]) {
    const priced = await quote([{ variantId: base.variants[0].variantId, quantity: units }]);
    expect(Number(priced.discount), `${units} units in groups of three`).toBe(discount);
  }
});

test("progress toward the next group is reported and updates as the cart changes", async () => {
  const base = await product();
  await withAutomaticOffer({ offerName: "E2E Progress Offer", requiredQuantity: 2, discountPerGroup: 500 });

  const one = await quote([{ variantId: base.variants[0].variantId, quantity: 1 }]);
  expect(one.automaticOffer.unitsToNextGroup).toBe(1);
  expect(one.automaticOffer.progressMessage).toMatch(/Add 1 more eligible item to receive another ₹500 discount/);

  const three = await quote([{ variantId: base.variants[0].variantId, quantity: 3 }]);
  expect(three.automaticOffer.unitsToNextGroup).toBe(1);

  // On a group boundary the next discount needs a whole new group, not zero more units.
  const four = await quote([{ variantId: base.variants[0].variantId, quantity: 4 }]);
  expect(four.automaticOffer.unitsToNextGroup).toBe(2);
});

// ── Lifecycle states ────────────────────────────────────────────────────────────────────────

test("inactive, scheduled, expired and archived offers do not discount anything", async () => {
  const base = await product();
  const lines = [{ variantId: base.variants[0].variantId, quantity: 4 }];

  const inactive = await withAutomaticOffer({ offerName: "E2E Inactive Offer", active: false });
  expect(Number((await quote(lines)).discount), "an inactive offer").toBe(0);

  const scheduled = await withAutomaticOffer({
    offerName: "E2E Scheduled Offer", active: true, startMinutes: 60, endMinutes: 60 * 24,
  });
  expect(scheduled.state, "created in the future").toBe("SCHEDULED");
  expect(Number((await quote(lines)).discount), "a scheduled offer").toBe(0);

  // Expiry is reached by moving the window in the database: the API refuses end <= start, and this
  // is the one state that otherwise only arrives with the passage of time.
  const expiring = await withAutomaticOffer({ offerName: "E2E Expiring Offer", active: true });
  expect(Number((await quote(lines)).discount), "live before expiry").toBe(1000);
  sql(`UPDATE AUTOMATIC_OFFERS SET STARTS_AT = UTC_TIMESTAMP() - INTERVAL 2 DAY,
       ENDS_AT = UTC_TIMESTAMP() - INTERVAL 1 DAY WHERE AUTOMATIC_OFFER_ID = ${expiring.automaticOfferId}`);
  expect(Number((await quote(lines)).discount), "an expired offer").toBe(0);

  const account = await admin();
  const archivable = await withAutomaticOffer({ offerName: "E2E Archivable Offer", active: true });
  expect(Number((await quote(lines)).discount), "live before archiving").toBe(1000);
  await account.client.del(`/offers/automatic/admin/${archivable.automaticOfferId}`);
  expect(Number((await quote(lines)).discount), "an archived offer").toBe(0);
  expect(Number(sqlValue(`SELECT IS_ACTIVE FROM AUTOMATIC_OFFERS WHERE AUTOMATIC_OFFER_ID=${archivable.automaticOfferId}`)),
    "archiving also deactivates").toBe(0);
  expect(inactive.state).toBe("INACTIVE");
});

test("activation and deactivation by an administrator switch the discount on and off", async () => {
  const base = await product();
  const lines = [{ variantId: base.variants[0].variantId, quantity: 2 }];
  const account = await admin();
  const offer = await withAutomaticOffer({ offerName: "E2E Toggle Offer", active: false });

  expect(Number((await quote(lines)).discount), "inactive on creation").toBe(0);

  const activated = await account.client.patch(
    `/offers/automatic/admin/${offer.automaticOfferId}/active?active=true&version=${offer.version}`);
  expect(activated.isActive).toBe(true);
  expect(Number((await quote(lines)).discount), "after activation").toBe(500);

  const deactivated = await account.client.patch(
    `/offers/automatic/admin/${offer.automaticOfferId}/active?active=false&version=${activated.version}`);
  expect(deactivated.isActive).toBe(false);
  expect(Number((await quote(lines)).discount), "after deactivation").toBe(0);
});

test("only one automatic offer can be live, and a second activation is refused with 409", async () => {
  const account = await admin();
  const live = await withAutomaticOffer({ offerName: "E2E Singleton Holder", active: true });
  const second = await account.client.post("/offers/automatic/admin", {
    offerName: "E2E Singleton Challenger", requiredQuantity: 2, discountPerGroup: 100,
    minimumOrderSubtotal: 0, scopeType: "ALL_PRODUCTS", productIds: [], categoryIds: [],
    startsAt: "2026-01-01T00:00:00", endsAt: "2030-01-01T00:00:00", isActive: false, priority: 0,
  });

  const refused = await account.client
    .patch(`/offers/automatic/admin/${second.automaticOfferId}/active?active=true&version=${second.version}`)
    .then(() => null)
    .catch((error) => error);

  expect(refused, "activating a second offer must fail").not.toBeNull();
  expect(refused.status).toBe(409);
  expect(refused.message, "the message names the offer holding the slot").toContain("E2E Singleton Holder");
  expect(Number(sqlValue("SELECT COUNT(*) FROM AUTOMATIC_OFFERS WHERE IS_ACTIVE = 1 AND ARCHIVED_AT IS NULL")),
    "still exactly one live offer").toBe(1);
  expect(live.isActive).toBe(true);
});

test("two administrators editing the same offer: the second save is refused, not silently applied", async () => {
  const account = await admin();
  const offer = await withAutomaticOffer({ offerName: "E2E Concurrent Edit", discountPerGroup: 500 });

  const edit = (discountPerGroup, version) => ({
    offerName: "E2E Concurrent Edit", bannerMessage: null, requiredQuantity: 2,
    discountPerGroup, minimumOrderSubtotal: 0, scopeType: "ALL_PRODUCTS",
    productIds: [], categoryIds: [], startsAt: "2026-01-01T00:00:00",
    endsAt: "2030-01-01T00:00:00", isActive: true, priority: 0, version,
  });

  // Both administrators loaded the same version.
  const staleVersion = offer.version;
  const first = await account.client.put(
    `/offers/automatic/admin/${offer.automaticOfferId}`, edit(600, staleVersion));
  expect(Number(first.discountPerGroup)).toBe(600);

  const second = await account.client
    .put(`/offers/automatic/admin/${offer.automaticOfferId}`, edit(700, staleVersion))
    .then(() => null)
    .catch((error) => error);

  expect(second, "the stale save must be refused").not.toBeNull();
  expect(second.status).toBe(409);
  expect(second.message).toMatch(/updated elsewhere/i);
  expect(Number(sqlValue(`SELECT DISCOUNT_PER_GROUP FROM AUTOMATIC_OFFERS WHERE AUTOMATIC_OFFER_ID=${offer.automaticOfferId}`)),
    "the first administrator's value survives").toBe(600);
});

test("a customer cannot reach any automatic-offer administration endpoint", async ({ page }) => {
  const offer = await withAutomaticOffer({ offerName: "E2E Authorization Offer" });
  const customer = await signInAsNewCustomer(page, "aoauthz");

  const attempts = [
    ["get", "/offers/automatic/admin", undefined],
    ["get", `/offers/automatic/admin/${offer.automaticOfferId}`, undefined],
    ["post", "/offers/automatic/admin", {
      offerName: "Hijacked", requiredQuantity: 2, discountPerGroup: 9999, scopeType: "ALL_PRODUCTS",
      startsAt: "2026-01-01T00:00:00", endsAt: "2030-01-01T00:00:00",
    }],
    ["put", `/offers/automatic/admin/${offer.automaticOfferId}`, {
      offerName: "Hijacked", requiredQuantity: 2, discountPerGroup: 9999, scopeType: "ALL_PRODUCTS",
      startsAt: "2026-01-01T00:00:00", endsAt: "2030-01-01T00:00:00", version: offer.version,
    }],
    ["del", `/offers/automatic/admin/${offer.automaticOfferId}`, undefined],
  ];

  for (const [method, path, body] of attempts) {
    const failure = await (body === undefined
      ? customer.client[method](path)
      : customer.client[method](path, body))
      .then(() => null)
      .catch((error) => error);
    expect(failure, `${method.toUpperCase()} ${path} must be refused`).not.toBeNull();
    expect([401, 403]).toContain(failure.status);
  }

  expect(sqlValue(`SELECT OFFER_NAME FROM AUTOMATIC_OFFERS WHERE AUTOMATIC_OFFER_ID=${offer.automaticOfferId}`),
    "nothing was changed").toBe("E2E Authorization Offer");
  expect(Number(sqlValue("SELECT COUNT(*) FROM AUTOMATIC_OFFERS WHERE OFFER_NAME='Hijacked'"))).toBe(0);
});

test("the server refuses an invalid configuration even when the form is bypassed", async () => {
  const account = await admin();
  const base = {
    offerName: "E2E Invalid", requiredQuantity: 2, discountPerGroup: 500, minimumOrderSubtotal: 0,
    scopeType: "ALL_PRODUCTS", productIds: [], categoryIds: [],
    startsAt: "2026-01-01T00:00:00", endsAt: "2030-01-01T00:00:00", isActive: false, priority: 0,
  };
  const rejected = async (overrides, why) => {
    const failure = await account.client.post("/offers/automatic/admin", { ...base, ...overrides })
      .then(() => null).catch((error) => error);
    expect(failure, why).not.toBeNull();
    expect(failure.status, why).toBe(400);
  };

  await rejected({ requiredQuantity: 1 }, "a group of one is not a quantity offer");
  await rejected({ requiredQuantity: 0 }, "a group of zero");
  await rejected({ discountPerGroup: 0 }, "a zero discount");
  await rejected({ discountPerGroup: -500 }, "a negative discount");
  await rejected({ startsAt: "2030-01-01T00:00:00", endsAt: "2026-01-01T00:00:00" }, "end before start");
  await rejected({ offerName: "" }, "a blank name");
  await rejected({ scopeType: "EVERYTHING" }, "an unknown scope");
  await rejected({ scopeType: "SELECTED_PRODUCTS", productIds: [] }, "a product scope with no products");
  await rejected({ scopeType: "SELECTED_PRODUCTS", productIds: [99999999] }, "an unknown product reference");
  await rejected({ scopeType: "SELECTED_CATEGORIES", categoryIds: [99999999] }, "an unknown category reference");
});

test("administrator display text is stored as plain text, never markup", async () => {
  const account = await admin();
  const created = await account.client.post("/offers/automatic/admin", {
    offerName: "E2E <b>Bold</b> Offer",
    bannerMessage: "<script>alert(1)</script>Two for ₹500 <a href=\"javascript:alert(2)\">now</a>",
    requiredQuantity: 2, discountPerGroup: 500, minimumOrderSubtotal: 0,
    scopeType: "ALL_PRODUCTS", productIds: [], categoryIds: [],
    startsAt: "2026-01-01T00:00:00", endsAt: "2030-01-01T00:00:00", isActive: false, priority: 0,
  });

  expect(created.offerName, "tags removed from the name").not.toMatch(/[<>]/);
  expect(created.bannerMessage, "tags removed from the banner").not.toMatch(/[<>]/);
  expect(created.bannerMessage, "no script content survives").not.toMatch(/alert|javascript:/);
  expect(created.bannerMessage, "the readable words are kept").toContain("Two for ₹500");
  // And what is stored is what was sanitised, not the raw input.
  expect(sqlValue(`SELECT BANNER_MESSAGE FROM AUTOMATIC_OFFERS WHERE AUTOMATIC_OFFER_ID=${created.automaticOfferId}`))
    .not.toMatch(/[<>]/);
});

test("a blank banner message falls back to wording generated from the configuration", async () => {
  const offer = await withAutomaticOffer({
    offerName: "E2E Generated Wording", bannerMessage: null, requiredQuantity: 2, discountPerGroup: 500,
  });
  expect(offer.effectiveBannerMessage).toBe(
    "Buy any 2 eligible products and get ₹500 off automatically for every complete pair.");
  expect(offer.termsMessage, "the terms are always generated, never customisable")
    .toBe("₹500 off every 2 eligible units. Unmatched units are not discounted.");

  const threes = await withAutomaticOffer({
    offerName: "E2E Generated Threes", bannerMessage: null, requiredQuantity: 3, discountPerGroup: 900,
  });
  expect(threes.effectiveBannerMessage).toContain("every complete group of 3");
});

// ── Stacking ────────────────────────────────────────────────────────────────────────────────

test("the automatic offer and a coupon do not stack: the larger applies and the other is explained", async ({ page }) => {
  const base = await product();
  await withAutomaticOffer({ offerName: "E2E Stacking Offer", requiredQuantity: 2, discountPerGroup: 500 });
  const account = await admin();
  const stamp = Date.now();

  const smallCode = `E2ESMALL${stamp}`;
  const largeCode = `E2ELARGE${stamp}`;
  for (const [code, value] of [[smallCode, 200], [largeCode, 5000]]) {
    await account.client.post("/coupons", {
      couponCode: code, description: "E2E stacking probe", discountType: "FIXED", discountValue: value,
      minimumOrderAmount: 0, maximumDiscountAmount: null, usageLimit: null, usageLimitPerUser: null,
      validFrom: "2026-01-01T00:00:00", validTo: "2030-01-01T00:00:00",
    });
  }

  const customer = await signInAsNewCustomer(page, "aostack");
  // The coupon endpoint prices the signed-in customer's server-side cart, so the cart has to hold
  // the units before a coupon comparison means anything.
  await addToBag(page, { productId: base.productId, quantity: 4, expectedBadge: 4 });

  const lines = [{ variantId: base.variants[0].variantId, quantity: 4 }];
  const offerWins = await customer.client.post(
    `/offers/automatic/quote?couponCode=${smallCode}`, { lines });
  expect(offerWins.appliedPromotion, "₹1,000 of offer beats a ₹200 coupon").toBe("AUTOMATIC_OFFER");
  expect(Number(offerWins.discount)).toBe(1000);
  expect(offerWins.suppressedPromotionLabel, "the coupon is named").toContain(smallCode);
  expect(offerWins.suppressedPromotionReason, "and the reason is stated")
    .toMatch(/cannot be combined/i);

  const couponWins = await customer.client.post(
    `/offers/automatic/quote?couponCode=${largeCode}`, { lines });
  expect(couponWins.appliedPromotion, "a ₹5,000 coupon beats ₹1,000 of offer").toBe("COUPON");
  // The coupon's ₹5,000 is capped at the ₹4,000 of merchandise before the comparison.
  expect(Number(couponWins.discount), "capped at the merchandise value").toBe(4000);
  expect(couponWins.suppressedPromotionLabel).toBe("E2E Stacking Offer");

  // Never both: each quote's discount is exactly one promotion's amount, not their sum.
  expect(Number(offerWins.discount), "offer alone, no coupon added").toBe(1000);
  expect(Number(couponWins.discount), "coupon alone, no offer added").toBe(4000);
  expect(Number(offerWins.discount)).not.toBe(1200);
  expect(Number(couponWins.discount)).not.toBe(5000);
});

// ── The full lifecycle through the browser ──────────────────────────────────────────────────

test("cart, checkout, payment, persisted order and refund all use one offer calculation", async ({ page }) => {
  const stamp = Date.now();
  // Three differently priced lines so the per-line allocation has remainders to distribute.
  const productA = await createProduct({
    name: `E2E Offer Life A ${stamp}`,
    variants: [{ sku: `AO-LA-${stamp}`, variantName: "A", color: "A", price: 1299, quantityAvailable: 30 }],
  });
  const productB = await createProduct({
    name: `E2E Offer Life B ${stamp}`,
    variants: [{ sku: `AO-LB-${stamp}`, variantName: "B", color: "B", price: 2100, quantityAvailable: 30 }],
  });
  const offer = await withAutomaticOffer({
    offerName: "E2E Lifecycle Offer", requiredQuantity: 2, discountPerGroup: 500,
  });

  const account = await signInAsNewCustomer(page, "aolife");
  await addToBag(page, { productId: productA.productId, quantity: 3, expectedBadge: 3 });
  await addToBag(page, { productId: productB.productId, quantity: 2, expectedBadge: 5 });

  // The bag shows the offer, the group arithmetic and the discount.
  await page.goto("/cart");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("cart-automatic-offer")).toContainText("E2E Lifecycle Offer");
  await expect(page.getByTestId("cart-offer-calc")).toContainText("2 qualifying groups");
  await expect(page.getByTestId("cart-offer-discount")).toContainText("1,000");
  await expect(page.getByTestId("cart-offer-progress")).toContainText("Add 1 more eligible item");

  const expectedSubtotal = 3 * 1299 + 2 * 2100;
  const expectedDiscount = 1000;
  const expectedTaxable = expectedSubtotal - expectedDiscount;
  const expectedTotal = Number((expectedTaxable + Number((expectedTaxable * 0.18).toFixed(2))).toFixed(2));

  // Checkout shows the same numbers, then charges exactly them.
  await page.goto("/order");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("checkout-automatic-offer")).toContainText("E2E Lifecycle Offer");
  await expect(page.getByTestId("checkout-discount-row")).toContainText("1,000");
  const orderId = await checkout(page, { account });

  const snapshot = offerSnapshotOf(orderId);
  expect(snapshot.offerId, "the order records which offer applied").toBe(offer.automaticOfferId);
  expect(snapshot.offerName).toBe("E2E Lifecycle Offer");
  expect(snapshot.requiredQuantity).toBe(2);
  expect(snapshot.discountPerGroup).toBe(500);
  expect(snapshot.eligibleQuantity).toBe(5);
  expect(snapshot.groups).toBe(2);
  expect(snapshot.offerDiscount).toBe(expectedDiscount);
  expect(snapshot.discountAmount, "the order-level discount is the offer's").toBe(expectedDiscount);
  expect(snapshot.subtotal).toBe(expectedSubtotal);
  expect(snapshot.total, "and the customer is charged the amount they confirmed").toBe(expectedTotal);

  // The per-line allocation adds up exactly, with nothing negative.
  const lines = lineDiscountsOf(orderId);
  const allocated = lines.reduce((sum, line) => sum + line.discountAmount, 0);
  expect(Number(allocated.toFixed(2)), "line shares reconcile to the order discount").toBe(expectedDiscount);
  for (const line of lines) {
    expect(line.discountAmount).toBeGreaterThan(0);
    expect(line.discountAmount).toBeLessThanOrEqual(line.lineTotal);
  }

  // The payment is for the discounted total, not the list price.
  expect(Number(sqlValue(`SELECT AMOUNT FROM PAYMENTS WHERE ORDER_ID=${orderId} ORDER BY PAYMENT_ID DESC LIMIT 1`)))
    .toBe(expectedTotal);

  // Customer order detail and admin order detail read the same snapshot.
  const customerView = await account.client.get(`/orders/${orderId}`);
  expect(customerView.appliedOffer.offerName).toBe("E2E Lifecycle Offer");
  expect(Number(customerView.appliedOffer.discount)).toBe(expectedDiscount);
  expect(customerView.appliedOffer.completeGroups).toBe(2);
  const adminAccount = await admin();
  const adminView = await adminAccount.client.get(`/orders/admin/${orderId}`);
  expect(adminView.appliedOffer.offerName).toBe("E2E Lifecycle Offer");
  expect(Number(adminView.appliedOffer.discount)).toBe(expectedDiscount);

  // The invoice is produced without error and is a real PDF.
  const invoice = await page.evaluate(async (id) => {
    const response = await fetch(`${window.location.origin.replace("3001", "8081")}/api/orders/${id}/invoice`,
      { credentials: "include" });
    return { status: response.status, head: (await response.text()).slice(0, 5) };
  }, orderId);
  expect(invoice.status).toBe(200);
  expect(invoice.head, "a PDF, not an error page").toContain("%PDF");

  // Editing the offer afterwards must not move this order's history.
  await adminAccount.client.put(`/offers/automatic/admin/${offer.automaticOfferId}`, {
    offerName: "E2E Lifecycle Offer RENAMED", bannerMessage: null, requiredQuantity: 4,
    discountPerGroup: 12345, minimumOrderSubtotal: 0, scopeType: "ALL_PRODUCTS",
    productIds: [], categoryIds: [], startsAt: "2026-01-01T00:00:00", endsAt: "2030-01-01T00:00:00",
    isActive: true, priority: 0,
    version: Number(sqlValue(`SELECT VERSION FROM AUTOMATIC_OFFERS WHERE AUTOMATIC_OFFER_ID=${offer.automaticOfferId}`)),
  });
  const afterEdit = offerSnapshotOf(orderId);
  expect(afterEdit.offerName, "a historical order keeps its original terms").toBe("E2E Lifecycle Offer");
  expect(afterEdit.discountPerGroup).toBe(500);
  expect(afterEdit.offerDiscount).toBe(expectedDiscount);
  expect(afterEdit.total).toBe(expectedTotal);

  // A partial return refunds the discounted value of the returned units, never the list price.
  expect(await markDelivered(orderId)).toBe("DELIVERED");
  const returnable = lines[0];
  const created = await account.client.post("/returns", {
    orderId,
    returnReason: "E2E partial return under an automatic offer",
    items: [{ orderItemId: returnable.orderItemId, quantity: 1, itemCondition: "UNOPENED",
      returnReason: "E2E partial return" }],
  });
  await adminAccount.client.patch(`/returns/admin/${created.returnId}/status`,
    { status: "APPROVED", adminComments: "E2E" });
  await adminAccount.client.patch(`/returns/admin/${created.returnId}/status`,
    { status: "PICKED_UP", adminComments: "E2E" });
  await adminAccount.client.patch(`/returns/admin/${created.returnId}/status`, {
    status: "RECEIVED", adminComments: "E2E",
    itemConditions: Object.fromEntries(
      (await adminAccount.client.get(`/returns/admin/all?size=200`)).content
        .find((row) => row.returnId === created.returnId).items
        .map((item) => [item.returnItemId, "UNOPENED"])),
  });

  const unitListPrice = returnable.lineTotal / returnable.quantity;
  const unitNetPrice = (returnable.lineTotal - returnable.discountAmount) / returnable.quantity;
  const paymentId = Number(sqlValue(`SELECT PAYMENT_ID FROM PAYMENTS WHERE ORDER_ID=${orderId} ORDER BY PAYMENT_ID DESC LIMIT 1`));
  const tooMuch = await adminAccount.client
    .post(`/refunds/payments/${paymentId}`, {
      returnId: created.returnId, refundAmount: Number((unitListPrice * 1.18 + 1).toFixed(2)),
      reason: "E2E over-refund probe",
    })
    .then(() => null).catch((error) => error);
  expect(tooMuch, "a refund at the undiscounted price must be refused").not.toBeNull();
  expect(tooMuch.status).toBe(400);
  expect(tooMuch.message).toMatch(/Maximum refundable/i);
  // The stated maximum is the discounted unit value plus its tax — what the customer actually paid.
  const maximum = Number(tooMuch.message.match(/Maximum refundable: ([0-9.]+)/)[1]);
  expect(maximum).toBeCloseTo(Number((unitNetPrice * 1.18).toFixed(2)), 1);
  expect(maximum, "and strictly less than the list price with tax").toBeLessThan(unitListPrice * 1.18);

  const refund = await adminAccount.client.post(`/refunds/payments/${paymentId}`, {
    returnId: created.returnId, refundAmount: maximum, reason: "E2E partial refund",
  });
  expect(Number(refund.refundAmount)).toBeCloseTo(maximum, 2);
});

test("a duplicate checkout submission does not place a second order or discount twice", async ({ page }) => {
  const base = await product();
  await withAutomaticOffer({ offerName: "E2E Idempotency Offer", requiredQuantity: 2, discountPerGroup: 500 });
  const account = await signInAsNewCustomer(page, "aoidem");
  await addToBag(page, { productId: base.productId, quantity: 2, expectedBadge: 2 });

  const address = await account.client.post("/addresses", {
    addressType: "SHIPPING", recipientName: "E2E Buyer", phoneNumber: "9876543210",
    addressLine1: "1 Test Street", city: "Bengaluru", state: "Karnataka",
    pincode: "560001", country: "India", isDefault: true,
  });

  const priced = await quote([{ variantId: base.variants[0].variantId, quantity: 2 }]);
  const body = {
    shippingAddressId: address.addressId, billingAddressId: address.addressId,
    couponCode: null, expectedTotalAmount: Number(priced.totalAmount),
    idempotencyKey: `e2e-idem-${Date.now()}`,
  };

  const first = await account.client.post("/orders", body);
  const second = await account.client.post("/orders", body);

  expect(second.orderId, "the retry returns the original order").toBe(first.orderId);
  expect(Number(sqlValue(`SELECT COUNT(*) FROM ORDERS WHERE IDEMPOTENCY_KEY='${body.idempotencyKey}'`)),
    "exactly one order row").toBe(1);
  const snapshot = offerSnapshotOf(first.orderId);
  expect(snapshot.offerDiscount, "discounted once").toBe(500);
  expect(snapshot.discountAmount).toBe(500);
  // And the offer was not applied twice to the money either.
  expect(snapshot.total).toBe(Number(priced.totalAmount));
});

test("an offer that expires between checkout and order creation stops the order rather than charging the old total", async ({ page }) => {
  const base = await product();
  const offer = await withAutomaticOffer({ offerName: "E2E Expiring Mid-Checkout", requiredQuantity: 2, discountPerGroup: 500 });
  const account = await signInAsNewCustomer(page, "aoexpire");
  await addToBag(page, { productId: base.productId, quantity: 2, expectedBadge: 2 });

  const address = await account.client.post("/addresses", {
    addressType: "SHIPPING", recipientName: "E2E Buyer", phoneNumber: "9876543210",
    addressLine1: "1 Test Street", city: "Bengaluru", state: "Karnataka",
    pincode: "560001", country: "India", isDefault: true,
  });

  // The customer was quoted the discounted total.
  const discounted = await quote([{ variantId: base.variants[0].variantId, quantity: 2 }]);
  expect(Number(discounted.discount)).toBe(500);

  // The offer expires while they are on the payment step.
  sql(`UPDATE AUTOMATIC_OFFERS SET ENDS_AT = UTC_TIMESTAMP() - INTERVAL 1 MINUTE
       WHERE AUTOMATIC_OFFER_ID = ${offer.automaticOfferId}`);

  const refused = await account.client.post("/orders", {
    shippingAddressId: address.addressId, billingAddressId: address.addressId,
    couponCode: null, expectedTotalAmount: Number(discounted.totalAmount),
    idempotencyKey: `e2e-expire-${Date.now()}`,
  }).then(() => null).catch((error) => error);

  expect(refused, "the stale total must not be charged").not.toBeNull();
  expect(refused.status).toBe(400);
  expect(refused.message).toMatch(/total changed/i);

  // Re-quoting shows the customer the real amount, and that amount is accepted.
  const reQuoted = await quote([{ variantId: base.variants[0].variantId, quantity: 2 }]);
  expect(Number(reQuoted.discount), "no discount now the offer has expired").toBe(0);
  const accepted = await account.client.post("/orders", {
    shippingAddressId: address.addressId, billingAddressId: address.addressId,
    couponCode: null, expectedTotalAmount: Number(reQuoted.totalAmount),
    idempotencyKey: `e2e-expire-ok-${Date.now()}`,
  });
  expect(offerSnapshotOf(accepted.orderId).offerDiscount, "and no offer is recorded").toBeNull();
});

test("a full cancellation reverses exactly what was charged under the offer", async ({ page }) => {
  const base = await product();
  await withAutomaticOffer({ offerName: "E2E Cancellation Offer", requiredQuantity: 2, discountPerGroup: 500 });
  const account = await signInAsNewCustomer(page, "aocancel");
  await addToBag(page, { productId: base.productId, quantity: 4, expectedBadge: 4 });
  const orderId = await checkout(page, { account });

  const snapshot = offerSnapshotOf(orderId);
  expect(snapshot.offerDiscount).toBe(1000);
  const charged = Number(sqlValue(`SELECT AMOUNT FROM PAYMENTS WHERE ORDER_ID=${orderId} ORDER BY PAYMENT_ID DESC LIMIT 1`));
  expect(charged).toBe(snapshot.total);

  await account.client.post(`/orders/${orderId}/cancel`, {});

  expect(sqlValue(`SELECT ORDER_STATUS FROM ORDERS WHERE ORDER_ID=${orderId}`)).toBe("CANCELLED");
  const refunded = Number(sqlValue(
    `SELECT COALESCE(SUM(r.REFUND_AMOUNT),0) FROM REFUNDS r JOIN PAYMENTS p ON p.PAYMENT_ID = r.PAYMENT_ID
     WHERE p.ORDER_ID = ${orderId}`));
  expect(refunded, "the discounted amount is reversed, not the list price").toBe(charged);
  expect(refunded).toBeLessThan(4 * OFFER_UNIT_PRICE);
  // The snapshot is untouched by the cancellation.
  expect(offerSnapshotOf(orderId).offerDiscount).toBe(1000);
});
