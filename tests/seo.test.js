const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test, afterEach } = require("node:test");
const sitemap = require("../api/sitemap");
const productSeo = require("../api/product-seo");

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    end() { this.body = ""; return this; },
  };
}

function jsonReply(value, status = 200) {
  return { ok: status < 400, status, json: async () => value };
}

test("sitemap includes every active catalog URL once", async () => {
  global.fetch = async (url) => {
    assert.match(url, /\/products\?page=0&size=200$/);
    return jsonReply({ totalPages: 1, content: [
      { slug: "cala-canyelles", isActive: true },
      { slug: "cala-canyelles", isActive: true },
      { slug: "draft", isActive: false },
    ] });
  };
  const res = response();
  await sitemap({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /application\/xml/);
  assert.equal((res.body.match(/<url>/g) || []).length, 4);
  assert.match(res.body, /https:\/\/www\.shadesworldindia\.com\/product\/cala-canyelles/);
  assert.doesNotMatch(res.body, /draft/);
});

test("direct product response contains one canonical, metadata, content and Product schema", async () => {
  const builtHtml = fs.readFileSync(path.join(__dirname, "../build/index.html"), "utf8");
  const product = {
    slug: "cala-canyelles", productName: "Cala Canyelles", isActive: true,
    productDescription: "Stylish blue sunglasses.", basePrice: 1999,
    images: [{ variantId: 7, isPrimary: true, imageUrl: "https://ik.imagekit.io/test/blue.jpg" }],
    variants: [{ variantId: 7, mainVariant: true, isActive: true, sku: "CALA-BLUE", price: 1999, quantityAvailable: 2 }],
  };
  global.fetch = async (url) => {
    if (url.endsWith("/products/slug/cala-canyelles")) return jsonReply(product);
    if (url.endsWith("/index.html")) return { ok: true, text: async () => builtHtml };
    throw new Error(`Unexpected URL: ${url}`);
  };
  const res = response();
  await productSeo({ method: "GET", query: { slug: "cala-canyelles" }, headers: { host: "example.vercel.app" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal((res.body.match(/rel="canonical"/g) || []).length, 1);
  assert.equal((res.body.match(/property="og:title"/g) || []).length, 1);
  assert.match(res.body, /<title>Cala Canyelles Sunglasses \| Shades World<\/title>/);
  assert.match(res.body, /<h1>Cala Canyelles Sunglasses<\/h1>/);
  assert.match(res.body, /"@type":"Product"/);
  assert.match(res.body, /"sku":"CALA-BLUE"/);
  assert.match(res.body, /"priceCurrency":"INR"/);
});

test("unknown product returns a real 404", async () => {
  global.fetch = async () => jsonReply({}, 404);
  const res = response();
  await productSeo({ method: "GET", query: { slug: "missing" }, headers: { host: "example.vercel.app" } }, res);
  assert.equal(res.statusCode, 404);
});
