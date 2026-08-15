// Product fixtures created through the real admin API, so the same validation, image handling and
// inventory-movement bookkeeping a real admin triggers is exercised here too.
const { createCustomer, promoteToAdmin, sql, sqlValue } = require("./api");

let adminPromise = null;

/**
 * One admin for the whole run. Registration is rate-limited per IP, so this is cached.
 *
 * A *rejected* promise is deliberately not kept. Creating this account is the most rate-limit-prone
 * thing the harness does — it spends a register, a verify-email and two logins — so it fails
 * transiently, and a cached rejection would then fail every remaining test in the run with the
 * first failure's message, burying whatever they were each meant to prove. Clearing the slot lets
 * the next caller make a real attempt.
 */
const admin = () => {
  if (!adminPromise) {
    const attempt = (async () => {
      const account = await createCustomer("admin");
      promoteToAdmin(account.userId);
      // The session must be re-established for the new role to appear in the principal. This is
      // the second login for this account inside one minute, so it goes through the backoff: a
      // bare post() here is exactly the call that used to poison the cache.
      await account.client.requestWithRateLimitBackoff(
        "POST", "/auth/login", { email: account.email, password: account.password }
      );
      return account;
    })();
    // Attached before the slot is published so the rejection is always handled here — otherwise a
    // failure at a moment when nothing is awaiting surfaces as an unhandled rejection instead.
    // The identity check keeps a late rejection from clearing a newer, healthy attempt.
    attempt.catch(() => { if (adminPromise === attempt) adminPromise = null; });
    adminPromise = attempt;
  }
  return adminPromise;
};

/**
 * Creates a product with two variants at known stock levels.
 * Returns the storefront shape the tests need, including per-variant ids and SKUs.
 */
const createProduct = async ({ name, categoryName = "Men", variants }) => {
  const account = await admin();
  const categoryId = Number(sqlValue(`SELECT CATEGORY_ID FROM CATEGORIES WHERE CATEGORY_NAME='${categoryName}' LIMIT 1`));
  const asVariantRequest = (variant) => ({
    sku: variant.sku,
    variantName: variant.variantName,
    variantDescription: variant.variantDescription ?? null,
    price: variant.price,
    quantityAvailable: variant.quantityAvailable,
    lowStockThreshold: variant.lowStockThreshold ?? 1,
    attributes: { color: variant.color },
  });

  // The structured family create: every variant in one request, list order becoming the family
  // order (index 0 = the Main Product at position 1). This is the same call the admin wizard
  // makes, so the fixtures exercise the real creation path.
  const created = await account.client.post("/products", {
    productName: name,
    productDescription: `${name} shared product copy`,
    brand: "Shades World",
    categoryIds: [categoryId],
    attributes: { frame_material: "Steel", uv_protection: "UV400" },
    variants: variants.map(asVariantRequest),
  });

  const full = await account.client.get(`/products/${created.productId}`);
  return {
    productId: full.productId,
    // The public identifier. Every storefront URL in these specs must be built from this — using
    // productId would assert the very thing the slug change removed.
    slug: full.slug,
    name: full.productName,
    variants: full.variants.map((variant) => ({
      variantId: variant.variantId, position: variant.position, mainVariant: variant.mainVariant,
      sku: variant.sku, variantName: variant.variantName,
      price: Number(variant.price), quantityAvailable: variant.quantityAvailable,
    })),
  };
};

/**
 * A real 2x2 PNG, written to disk so it can be handed to a file input or a multipart upload.
 *
 * Deliberately a genuine PNG rather than bytes with a .png name: the backend decodes every upload
 * and compares the real format against the declared Content-Type, so a fake would be rejected —
 * which is exactly what disguisedFile() below relies on.
 */
/**
 * A real 1x1 PNG in a colour of our choosing, built here rather than pasted as a constant.
 *
 * Distinct bytes per call is now a requirement, not a nicety: the upload endpoint refuses a
 * photograph a product already holds (that duplicate is the root cause of the out-of-stock colour
 * appearing in every gallery). A single shared PNG constant made every fixture image byte-identical,
 * so the second upload to any product would be correctly rejected and the suite would fail for a
 * reason that has nothing to do with what it is testing.
 *
 * Encoded properly — IHDR/IDAT/IEND with real CRCs — because the backend decodes every upload and
 * checks the decoded format against the declared Content-Type. Appending junk to a fixed PNG would
 * be simpler and would stop being a valid test of that check.
 */
const zlib = require("zlib");

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
};

let pngCounter = 0;

/** A 1x1 RGB PNG whose colour is unique to this call. */
const pngBytes = () => {
  pngCounter += 1;
  const red = pngCounter & 0xff;
  const green = (pngCounter >> 8) & 0xff;
  const blue = (pngCounter >> 16) & 0xff;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);        // width
  header.writeUInt32BE(1, 4);        // height
  header[8] = 8;                     // bit depth
  header[9] = 2;                     // colour type: truecolour RGB
  // 10..12 are compression, filter and interlace, all 0.
  const raw = Buffer.from([0, red, green, blue]); // one scanline: filter byte 0, then the pixel
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

const imageFile = (name = "photo.png") => {
  const fs = require("fs");
  const path = require("path");
  const directory = fs.mkdtempSync(path.join(require("os").tmpdir(), "e2e-images-"));
  const file = path.join(directory, name);
  fs.writeFileSync(file, pngBytes());
  return file;
};

/** An HTML document named .png — the "script disguised as an image" case §10 asks about. */
const disguisedFile = (name = "evil.png") => {
  const fs = require("fs");
  const path = require("path");
  const directory = fs.mkdtempSync(path.join(require("os").tmpdir(), "e2e-images-"));
  const file = path.join(directory, name);
  fs.writeFileSync(file, "<html><script>alert(1)</script></html>");
  return file;
};

/**
 * Uploads an image through the real multipart endpoint as the admin.
 *
 * Uses undici's FormData/Blob rather than the ApiClient's JSON path, because the endpoint this is
 * exercising only accepts multipart/form-data — sending JSON here would test a different route.
 */
const uploadImage = async ({ productId, variantId = null, altText = "", displayOrder = 0, isPrimary = false,
  file = null, contentType = "image/png" }) => {
  const account = await admin();
  const fs = require("fs");
  const form = new FormData();
  const bytes = file ? fs.readFileSync(file) : pngBytes();
  form.append("file", new Blob([bytes], { type: contentType }), file ? require("path").basename(file) : "photo.png");
  form.append("altText", altText);
  form.append("displayOrder", String(displayOrder));
  form.append("isPrimary", String(isPrimary));
  if (variantId != null) form.append("variantId", String(variantId));
  return account.client.multipart(`/products/${productId}/images/upload`, form);
};

/** One product's images straight from the database, in the order the gallery must render them. */
const imageRowsOf = (productId) =>
  sql(`SELECT CONCAT(IMAGE_ID,':',DISPLAY_ORDER,':',IS_PRIMARY,':',COALESCE(VARIANT_ID,'-'),':',COALESCE(ALT_TEXT,''))
       FROM PRODUCT_IMAGES WHERE PRODUCT_ID=${Number(productId)}
       ORDER BY IS_PRIMARY DESC, DISPLAY_ORDER, IMAGE_ID`)
    .split("\n").map((row) => row.trim()).filter(Boolean);

/** Stock straight from the database — the authority the UI is being checked against. */
const stockOf = (variantId) => Number(sqlValue(`SELECT QUANTITY_AVAILABLE FROM PRODUCT_VARIANTS WHERE VARIANT_ID=${Number(variantId)}`));

/** SALE / CANCELLATION rows for an order, proving a decrement happened exactly once. */
const movementsForOrder = (orderId) =>
  sql(`SELECT CONCAT(MOVEMENT_TYPE,':',VARIANT_ID,':',QUANTITY_CHANGE) FROM INVENTORY_MOVEMENTS
       WHERE REFERENCE_ID=${Number(orderId)} ORDER BY INVENTORY_MOVEMENT_ID`)
    // MySQL pads the CONCAT result for the fixed-width quantity column, so trim each row.
    .split("\n").map((row) => row.trim()).filter(Boolean);

const orderStatus = (orderId) => sqlValue(`SELECT ORDER_STATUS FROM ORDERS WHERE ORDER_ID=${Number(orderId)}`);

/** Marks an order DELIVERED through the real admin endpoint — the only route to a reviewable item. */
const markDelivered = async (orderId) => {
  const account = await admin();
  for (const status of ["PROCESSING", "SHIPPED", "DELIVERED"]) {
    try { await account.client.patch(`/orders/admin/${orderId}/status`, { status, notes: "E2E fixture transition" }); }
    catch (error) { if (!/transition|status/i.test(error.message)) throw error; }
  }
  return orderStatus(orderId);
};

// ── Automatic quantity offer ─────────────────────────────────────────────────────────────────
//
// Created through the real admin API so the same validation, sanitisation and single-active-offer
// rule a real administrator hits is exercised here. The database allows only one active offer, so
// every spec that needs one calls withAutomaticOffer, which clears any leftover first — otherwise
// the second spec in a run would fail with a 409 about the first spec's offer rather than with
// whatever it was actually testing.

const isoLocal = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

/** Deactivates and archives every live offer, so the next activation cannot collide. */
const clearAutomaticOffers = () => {
  sql("UPDATE AUTOMATIC_OFFERS SET IS_ACTIVE = 0, ARCHIVED_AT = UTC_TIMESTAMP() WHERE ARCHIVED_AT IS NULL");
};

/**
 * Creates (and by default activates) an automatic offer.
 *
 * @param requiredQuantity group size, at least 2
 * @param discountPerGroup amount off per complete group
 * @param offsetMinutes    {start, end} relative to now, for scheduled and expired cases. An expired
 *                         offer has to be created active-and-in-window then moved, because the API
 *                         validates end > start — the SQL nudge below is how a spec reaches a state
 *                         that only the passage of time would otherwise produce.
 */
const createAutomaticOffer = async ({
  offerName, bannerMessage = null, requiredQuantity = 2, discountPerGroup = 500,
  minimumOrderSubtotal = 0, scopeType = "ALL_PRODUCTS", productIds = [], categoryIds = [],
  active = true, startMinutes = -60, endMinutes = 60 * 24 * 30,
} = {}) => {
  const account = await admin();
  const now = Date.now();
  const created = await account.client.post("/offers/automatic/admin", {
    offerName, bannerMessage, requiredQuantity, discountPerGroup, minimumOrderSubtotal,
    scopeType, productIds, categoryIds,
    startsAt: isoLocal(new Date(now + startMinutes * 60_000)),
    endsAt: isoLocal(new Date(now + endMinutes * 60_000)),
    isActive: active,
    priority: 0,
  });
  return created;
};

/** Clears whatever was live, then creates the offer this spec wants. */
const withAutomaticOffer = async (options = {}) => {
  clearAutomaticOffers();
  return createAutomaticOffer(options);
};

const automaticOfferRow = (offerId) =>
  sql(`SELECT CONCAT(IS_ACTIVE,'|',VERSION,'|',IFNULL(ARCHIVED_AT,'-')) FROM AUTOMATIC_OFFERS
       WHERE AUTOMATIC_OFFER_ID=${Number(offerId)}`).trim();

/** The order's frozen offer snapshot, straight from the database. */
const offerSnapshotOf = (orderId) => {
  const row = sql(`SELECT CONCAT_WS('|', IFNULL(AUTO_OFFER_ID,'-'), IFNULL(AUTO_OFFER_NAME,'-'),
      IFNULL(AUTO_OFFER_REQUIRED_QUANTITY,'-'), IFNULL(AUTO_OFFER_DISCOUNT_PER_GROUP,'-'),
      IFNULL(AUTO_OFFER_ELIGIBLE_QUANTITY,'-'), IFNULL(AUTO_OFFER_GROUPS,'-'),
      IFNULL(AUTO_OFFER_DISCOUNT,'-'), DISCOUNT_AMOUNT, SUBTOTAL_AMOUNT, TOTAL_AMOUNT)
      FROM ORDERS WHERE ORDER_ID=${Number(orderId)}`).trim();
  const [offerId, offerName, requiredQuantity, discountPerGroup, eligibleQuantity, groups,
    offerDiscount, discountAmount, subtotal, total] = row.split("|");
  return {
    offerId: offerId === "-" ? null : Number(offerId),
    offerName: offerName === "-" ? null : offerName,
    requiredQuantity: requiredQuantity === "-" ? null : Number(requiredQuantity),
    discountPerGroup: discountPerGroup === "-" ? null : Number(discountPerGroup),
    eligibleQuantity: eligibleQuantity === "-" ? null : Number(eligibleQuantity),
    groups: groups === "-" ? null : Number(groups),
    offerDiscount: offerDiscount === "-" ? null : Number(offerDiscount),
    discountAmount: Number(discountAmount),
    subtotal: Number(subtotal),
    total: Number(total),
  };
};

/** Per-line discount allocation as stored, keyed by order item id. */
const lineDiscountsOf = (orderId) =>
  sql(`SELECT CONCAT(ORDER_ITEM_ID,'|',VARIANT_ID,'|',QUANTITY,'|',LINE_TOTAL,'|',DISCOUNT_AMOUNT)
       FROM ORDER_ITEMS WHERE ORDER_ID=${Number(orderId)} ORDER BY ORDER_ITEM_ID`)
    .split("\n").map((row) => row.trim()).filter(Boolean)
    .map((row) => {
      const [orderItemId, variantId, quantity, lineTotal, discountAmount] = row.split("|");
      return {
        orderItemId: Number(orderItemId), variantId: Number(variantId),
        quantity: Number(quantity), lineTotal: Number(lineTotal),
        discountAmount: Number(discountAmount),
      };
    });

module.exports = {
  admin, createProduct, markDelivered, movementsForOrder, orderStatus, stockOf,
  disguisedFile, imageFile, imageRowsOf, uploadImage,
  automaticOfferRow, clearAutomaticOffers, createAutomaticOffer, lineDiscountsOf,
  offerSnapshotOf, withAutomaticOffer,
};
