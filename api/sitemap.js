const { SITE_URL, escapeHtml, fetchJson } = require("../lib/seo");

module.exports = async function sitemap(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }
  try {
    const products = [];
    for (let page = 0; page < 50; page += 1) {
      const data = await fetchJson(`/products?page=${page}&size=200`);
      products.push(...(data.content || []));
      const totalPages = data.totalPages ?? data.page?.totalPages ?? 1;
      if (page + 1 >= totalPages) break;
    }
    const paths = ["/", "/shop", "/collections",
      ...["men", "women", "unisex", "accessory"].map((name) => `/collections/${name}`),
      ...["about", "contact", "shipping", "returns", "faq", "size-guide", "privacy", "terms"].map((name) => `/info/${name}`),
      ...products.filter((product) => product.isActive && product.slug)
        .map((product) => `/product/${encodeURIComponent(product.slug)}`)];
    const urls = [...new Set(paths)].map((path) =>
      `  <url><loc>${escapeHtml(`${SITE_URL}${path}`)}</loc></url>`).join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
      + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).send(req.method === "HEAD" ? "" : xml);
  } catch (error) {
    res.setHeader("Retry-After", "300");
    return res.status(503).send("Sitemap temporarily unavailable");
  }
};
