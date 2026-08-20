import { galleryFor, imageForVariant, isBorrowedImage, mainVariantOf, mapProduct, selectDefaultVariant } from "./StoreContext";

/**
 * Which photos a colourway shows, under the product-family redesign.
 *
 * The rule is deliberately short and deterministic (see galleryFor):
 *   1. the selected variant's own photos, main image first;
 *   2. else the Main Product's (variant 1's) gallery, labelled as a stand-in;
 *   3. else nothing — the gallery renders its placeholder frame.
 * No other variant's photography is ever mixed in, and "general product photos" no longer exist:
 * an image that still arrives without a variantId is read as the Main Product's, which is where
 * the migration filed such rows.
 */

const image = (id, variantId, alt, isPrimary = false) =>
  ({ imageId: id, publicId: `p${id}`, imageUrl: `/img/${id}.jpg`, altText: alt, variantId, isPrimary });
const variant = (id, position, quantityAvailable, isActive = true) =>
  ({ variantId: id, position, mainVariant: position === 1, sku: `SKU${id}`, price: 100, quantityAvailable, isActive });

const MAIN = variant(10, 1, 0);       // the Main Product — sold out in most fixtures here
const ORANGE = variant(11, 2, 5);     // in stock, the one the fallback rule selects
const GREEN = variant(12, 3, 7);      // in stock

describe("galleryFor", () => {
  test("a variant shows its own photos only, main image first", () => {
    // The server orders a product's images main-first; the per-variant filter must preserve that,
    // so the variant's main image is frame one and its additional photos follow in saved order.
    const product = {
      variants: [MAIN, ORANGE],
      images: [image(2, 11, "orange-main", true), image(3, 11, "orange-b"), image(4, 11, "orange-c"),
        image(1, 10, "main-hero", true)],
    };
    expect(galleryFor(product, ORANGE).map((i) => i.altText))
      .toEqual(["orange-main", "orange-b", "orange-c"]);
  });

  test("another variant's gallery is never mixed into a variant that has its own photos", () => {
    const product = { variants: [MAIN, ORANGE], images: [image(1, 10, "main-hero", true), image(2, 11, "orange", true)] };
    expect(galleryFor(product, ORANGE).map((i) => i.altText)).toEqual(["orange"]);
    expect(galleryFor(product, MAIN).map((i) => i.altText)).toEqual(["main-hero"]);
  });

  test("a variant with no photos falls back to the Main Product's gallery, and says so", () => {
    const product = { variants: [MAIN, ORANGE], images: [image(1, 10, "main-hero", true), image(5, 10, "main-b")] };
    const gallery = galleryFor(product, ORANGE);
    expect(gallery.map((i) => i.altText)).toEqual(["main-hero", "main-b"]);
    expect(isBorrowedImage(product, ORANGE, gallery[0])).toBe(true);
  });

  test("a legacy image without a variantId is read as the Main Product's", () => {
    // The migration files these rows onto variant 1; a payload that predates it must render the
    // same way rather than differently until the server restarts.
    const product = { variants: [MAIN, ORANGE], images: [image(1, null, "legacy-general")] };
    expect(galleryFor(product, MAIN).map((i) => i.altText)).toEqual(["legacy-general"]);
    expect(galleryFor(product, ORANGE).map((i) => i.altText)).toEqual(["legacy-general"]);
    expect(isBorrowedImage(product, MAIN, product.images[0])).toBe(false);
    expect(isBorrowedImage(product, ORANGE, product.images[0])).toBe(true);
  });

  test("when neither the variant nor the Main Product has photos, the gallery is empty", () => {
    // Empty means the placeholder frame — never a sibling variant's photograph (rule 6). GREEN has
    // a photo, but GREEN is not the Main Product, so ORANGE must not show it.
    const product = { variants: [MAIN, ORANGE, GREEN], images: [image(3, 12, "green", true)] };
    expect(galleryFor(product, ORANGE)).toEqual([]);
    expect(imageForVariant(product, ORANGE)).toBeUndefined();
  });

  test("a product with no images at all yields an empty gallery, not a crash", () => {
    expect(galleryFor({ variants: [ORANGE], images: [] }, ORANGE)).toEqual([]);
    expect(galleryFor(undefined, undefined)).toEqual([]);
    expect(imageForVariant({ variants: [], images: [] }, null)).toBeUndefined();
  });

  test("the gallery is deterministic across repeated calls", () => {
    const product = { variants: [MAIN, ORANGE], images: [image(5, 10, "main-b"), image(1, 10, "main-hero", true)] };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(galleryFor(product, ORANGE).map((i) => i.altText)).toEqual(["main-b", "main-hero"]);
    }
  });
});

describe("mainVariantOf", () => {
  test("is the variant at position 1, regardless of array order", () => {
    expect(mainVariantOf({ variants: [GREEN, ORANGE, MAIN] }).variantId).toBe(10);
  });
  test("falls back to family order for a payload without positions", () => {
    const legacyA = { variantId: 21, quantityAvailable: 1 };
    const legacyB = { variantId: 22, quantityAvailable: 1 };
    expect(mainVariantOf({ variants: [legacyB, legacyA] }).variantId).toBe(21);
  });
});

describe("selectDefaultVariant", () => {
  test("selects the Main Product when it is purchasable", () => {
    const buyableMain = variant(10, 1, 3);
    expect(selectDefaultVariant([ORANGE, buyableMain]).variantId).toBe(10);
  });
  test("falls back to the first purchasable variant in family order when the main is sold out", () => {
    expect(selectDefaultVariant([GREEN, MAIN, ORANGE]).variantId).toBe(11);
  });
  test("honours a ?variant= POSITION deep link only when purchasable", () => {
    expect(selectDefaultVariant([MAIN, ORANGE, GREEN], "3").variantId).toBe(12);
    // Position 1 is sold out, so the link is not honoured and the rule falls back.
    expect(selectDefaultVariant([MAIN, ORANGE, GREEN], "1").variantId).toBe(11);
    // A legacy link carrying a raw variant id matches no position and falls back too.
    expect(selectDefaultVariant([MAIN, ORANGE, GREEN], "12").variantId).toBe(11);
  });
  test("returns null when nothing is purchasable", () => {
    expect(selectDefaultVariant([MAIN, variant(14, 2, 0)])).toBeNull();
  });
});

describe("the listing card picks the same photo", () => {
  test("a card selling the fallback variant uses that variant's own photo when it has one", () => {
    const mapped = mapProduct({
      productId: 1, slug: "s", productName: "Frame", basePrice: 100, isNew: false,
      variants: [
        { ...MAIN, variantName: "Main" },
        { ...ORANGE, variantName: "Orange" },
      ],
      images: [image(1, 10, "main-hero", true), image(2, 11, "orange", true)],
      categories: [], attributes: {},
    });
    expect(mapped.color).toBe("Orange");
    expect(mapped.image).toBe("/img/2.jpg");
  });

  test("a card whose committed variant has no photo retains the Main Product's image", () => {
    // Sanctioned by the redesign: the Main Product's main image fronts the family in listings,
    // and the product page then labels it as a stand-in for the selected colourway.
    const mapped = mapProduct({
      productId: 1, slug: "s", productName: "Frame", basePrice: 100, isNew: false,
      variants: [
        { ...MAIN, variantName: "Main" },
        { ...ORANGE, variantName: "Orange" },
      ],
      images: [image(1, 10, "main-hero", true)],
      categories: [], attributes: {},
    });
    expect(mapped.color).toBe("Orange");
    expect(mapped.image).toBe("/img/1.jpg");
  });

  test("cards iterate variants in family order, main first", () => {
    const mapped = mapProduct({
      productId: 1, slug: "s", productName: "Frame", basePrice: 100, isNew: false,
      variants: [
        { ...GREEN, variantName: "Green" },
        { ...variant(10, 1, 2), variantName: "Main" },
        { ...ORANGE, variantName: "Orange" },
      ],
      images: [],
      categories: [], attributes: {},
    });
    expect(mapped.variants.map((candidate) => candidate.variantName)).toEqual(["Main", "Orange", "Green"]);
    expect(mapped.color).toBe("Main");
  });
});

describe("mapProduct hoverImage — the card's hover reveal", () => {
  // MAIN is sold out in these fixtures, so the card commits ORANGE: the hover photo must therefore
  // be ORANGE's second frame. Getting this wrong shows the shopper a different colour on hover than
  // the one the card is selling, which is the same class of bug the gallery rule exists to prevent.
  const productWith = (images) => ({
    productId: 14, productName: "Rayban", basePrice: 100, isActive: true,
    variants: [MAIN, ORANGE, GREEN], images, categories: [], attributes: {},
  });

  test("is the committed variant's FIRST ADDITIONAL photo, not the main one", () => {
    const mapped = mapProduct(productWith([
      image(2, 11, "orange-main", true), image(3, 11, "orange-second"), image(4, 11, "orange-third"),
      image(1, 10, "main-hero", true),
    ]));
    expect(mapped.image).toBe("/img/2.jpg");        // frame one: the main photo
    expect(mapped.hoverImage).toBe("/img/3.jpg");   // frame two: the first additional photo
    expect(mapped.hoverImageAlt).toBe("orange-second");
  });

  test("never borrows another colourway's photo for the hover frame", () => {
    // ORANGE has exactly one photo; GREEN has several. The hover frame must stay empty rather than
    // reach across to GREEN's second image.
    const mapped = mapProduct(productWith([
      image(2, 11, "orange-only", true),
      image(5, 12, "green-main", true), image(6, 12, "green-second"),
    ]));
    expect(mapped.image).toBe("/img/2.jpg");
    expect(mapped.hoverImage).toBe("");
  });

  test("is empty when the committed variant has only its main photo", () => {
    const mapped = mapProduct(productWith([image(2, 11, "orange-main", true), image(1, 10, "main-hero", true)]));
    expect(mapped.hoverImage).toBe("");
    expect(mapped.hoverImageAlt).toBe("");
  });

  test("follows the borrowed gallery when the committed variant has no photos of its own", () => {
    // ORANGE has none, so galleryFor falls back to the Main Product's gallery — and the hover frame
    // must come from that same borrowed gallery rather than from nowhere.
    const mapped = mapProduct(productWith([image(1, 10, "main-hero", true), image(7, 10, "main-second")]));
    expect(mapped.image).toBe("/img/1.jpg");
    expect(mapped.hoverImage).toBe("/img/7.jpg");
  });

  test("is empty for a product with no images at all, rather than undefined", () => {
    const mapped = mapProduct(productWith([]));
    expect(mapped.image).toBe("");
    expect(mapped.hoverImage).toBe("");
  });
});
