const {
  SITE_URL, escapeHtml, plainText, snippet, safeJson, fetchJson,
  publicImage, primaryVariant, primaryImage,
} = require("../lib/seo");

const slugPattern = /^[a-z0-9-]+$/;

module.exports = async function productSeo(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }
  const slug = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  if (!slugPattern.test(slug || "")) return res.status(404).send("Product not found");

  try {
    if (/^\d+$/.test(slug)) {
      const canonical = await fetchJson(`/products/${slug}/canonical`);
      res.setHeader("Location", `/product/${encodeURIComponent(canonical.slug)}`);
      return res.status(308).end();
    }
    const product = await fetchJson(`/products/slug/${encodeURIComponent(slug)}`);
    if (!product?.isActive || product.slug !== slug) return res.status(404).send("Product not found");

    const host = String(req.headers.host || "");
    if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return res.status(400).send("Invalid host");
    const protocol = req.headers["x-forwarded-proto"] === "http" ? "http" : "https";
    const templateResponse = await fetch(`${protocol}://${host}/index.html`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!templateResponse.ok) throw new Error(`HTML template returned ${templateResponse.status}`);
    let html = await templateResponse.text();
    const rootPattern = /<div id="root">[\s\S]*?<\/div>/i;
    if (!rootPattern.test(html)) throw new Error("HTML template has no root element");

    const url = `${SITE_URL}/product/${encodeURIComponent(product.slug)}`;
    const title = `${product.productName} Sunglasses | Shades World India`;
    const description = snippet(product.productDescription
      || `Shop ${product.productName} sunglasses from Shades World India.`);
    const variant = primaryVariant(product);
    const image = publicImage(primaryImage(product, variant));
    const price = Number(variant?.price ?? product.basePrice);
    const inStock = product.variants?.some((item) => item.isActive && Number(item.quantityAvailable) > 0);
    const schema = {
      "@context": "https://schema.org", "@type": "Product",
      name: product.productName, description: plainText(product.productDescription),
      url, brand: { "@type": "Brand", name: "Shades World" },
      ...(image ? { image: [image] } : {}),
      ...(variant?.sku ? { sku: variant.sku } : {}),
      ...(Number.isFinite(price) ? { offers: {
        "@type": "Offer", url, priceCurrency: "INR", price,
        availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      } } : {}),
    };
    const head = [
      `<link rel="canonical" href="${escapeHtml(url)}" />`,
      `<meta property="og:type" content="product" />`,
      `<meta property="og:site_name" content="Shades World India" />`,
      `<meta property="og:title" content="${escapeHtml(title)}" />`,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
      `<meta property="og:url" content="${escapeHtml(url)}" />`,
      ...(image ? [`<meta property="og:image" content="${escapeHtml(image)}" />`] : []),
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<script id="product-jsonld" type="application/ld+json">${safeJson(schema)}</script>`,
    ].join("");
    const initialContent = `<main><h1>${escapeHtml(product.productName)} Sunglasses</h1>`
      + (image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.productName)} sunglasses" />` : "")
      + (Number.isFinite(price) ? `<p>₹${escapeHtml(price.toFixed(2))}</p>` : "")
      + `<p>${escapeHtml(plainText(product.productDescription))}</p>`
      + `<p><a href="/shop">Shop all sunglasses</a></p></main>`;
    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`)
      .replace(/<meta\s+name="description"[^>]*>/i,
        `<meta name="description" content="${escapeHtml(description)}" />`)
      .replace(/<link\s+rel="canonical"[^>]*>/i, "")
      .replace(/<meta\s+property="og:[^"]+"[^>]*>/gi, "")
      .replace(/<meta\s+name="twitter:card"[^>]*>/gi, "")
      .replace("</head>", `${head}</head>`)
      .replace(rootPattern, `<div id="root">${initialContent}</div>`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    return res.status(200).send(req.method === "HEAD" ? "" : html);
  } catch (error) {
    if (error.status === 404) return res.status(404).send("Product not found");
    res.setHeader("Retry-After", "120");
    return res.status(503).send("Product page temporarily unavailable");
  }
};
