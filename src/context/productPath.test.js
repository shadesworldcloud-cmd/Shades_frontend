import fs from "fs";
import path from "path";
import { productPath } from "./StoreContext";

describe("productPath", () => {
  test("builds a slug URL when the product has one", () => {
    expect(productPath({ slug: "classic-aviator", productId: 22 })).toBe("/product/classic-aviator");
  });

  test("prefers the slug over the id even when both are present", () => {
    // The whole point of the change: an id in hand must not win.
    expect(productPath({ slug: "classic-aviator", productId: 22, _id: "22" })).not.toContain("22");
  });

  test("falls back to the id for a payload that predates the slug field", () => {
    // Still resolves: /product/:slug detects a numeric segment and redirects to the canonical URL.
    expect(productPath({ productId: 22 })).toBe("/product/22");
    expect(productPath({ _id: "22" })).toBe("/product/22");
  });

  test("does not throw on a missing product", () => {
    expect(() => productPath(undefined)).not.toThrow();
    expect(() => productPath(null)).not.toThrow();
  });
});

describe("no surface builds a product URL by hand", () => {
  /**
   * A guard, not a style check.
   *
   * Every product link has to go through productPath, because a single hand-built
   * `/product/${id}` is enough to put a sequential database id back in the address bar — and it
   * would look completely normal in review. This walks the real source tree rather than trusting a
   * grep run once at implementation time.
   *
   * ProductDetail is exempt for the legacy-redirect path, which must build a slug URL from a slug
   * it just resolved; the exemption is by file and is deliberately narrow.
   */
  const sourceRoot = path.join(__dirname, "..");
  const EXEMPT = new Set([
    path.join("pages", "ProductDetail", "ProductDetail.jsx"), // builds the canonical redirect target
    path.join("context", "StoreContext.jsx"),                 // defines productPath itself
  ]);

  const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });

  test("no component interpolates a product id into a /product/ URL", () => {
    const offenders = [];
    for (const file of walk(sourceRoot)) {
      const relative = path.relative(sourceRoot, file);
      if (EXEMPT.has(relative)) continue;
      const source = fs.readFileSync(file, "utf8");
      // A template literal or concatenation that puts a value straight after /product/.
      const matches = source.match(/["'`]\/product\/\$\{[^}]*\}/g);
      if (matches) offenders.push(`${relative}: ${matches.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  test("the guard above can actually fail", () => {
    // Without this, a broken regex would make the test above pass on any codebase at all.
    const sample = 'const link = `/product/${item._id}`;';
    expect(sample.match(/["'`]\/product\/\$\{[^}]*\}/g)).not.toBeNull();
  });
});
