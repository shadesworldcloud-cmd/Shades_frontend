const { SITE_URL, escapeHtml } = require("../lib/seo");

const infoPages = {
  about: ["About Shades World Barcelona", "Learn about Shades World Barcelona and how we curate eyewear for men, women and unisex styles."],
  contact: ["Contact Shades World", "Contact Shades World for help with sunglasses, orders and delivery."],
  shipping: ["Shipping & Delivery", "Find delivery information for Shades World online orders."],
  returns: ["Exchanges & Returns", "Read the Shades World exchange and return information for online purchases."],
  faq: ["Frequently Asked Questions", "Answers to common questions about Shades World products and orders."],
  "size-guide": ["Sunglasses Size Guide", "Find your fit with the Shades World sunglasses size guide."],
  privacy: ["Privacy Policy", "Read how Shades World handles customer information."],
  terms: ["Terms & Conditions", "Read the Shades World terms and conditions."],
};

const collections = {
  men: ["Men's Sunglasses", "Explore Shades World sunglasses and eyewear styles for men."],
  women: ["Women's Sunglasses", "Explore Shades World sunglasses and eyewear styles for women."],
  unisex: ["Unisex Sunglasses", "Explore versatile unisex sunglasses from Shades World."],
  accessory: ["Eyewear Accessories", "Explore sunglasses cases, cloths and care accessories from Shades World."],
};

function pageDetails(query) {
  if (query.page === "shop") return { path: "/shop", title: "Shop Sunglasses Online", description: "Browse Shades World sunglasses for men and women. Find unisex and polarized styles in a range of colours.", links: ["/collections/men", "/collections/women", "/collections/unisex"] };
  if (query.page === "collections") return { path: "/collections", title: "Sunglasses Collections", description: "Explore the Shades World sunglasses collections for men, women and unisex styles.", links: Object.keys(collections).map((name) => `/collections/${name}`) };
  if (query.page === "collection" && collections[query.collection]) {
    const [title, description] = collections[query.collection];
    return { path: `/collections/${query.collection}`, title, description, links: ["/shop"] };
  }
  if (query.page === "info" && infoPages[query.info]) {
    const [title, description] = infoPages[query.info];
    return { path: `/info/${query.info}`, title, description, links: ["/shop"] };
  }
  return null;
}

module.exports = async function pageSeo(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }
  const page = pageDetails(req.query || {});
  if (!page) return res.status(404).send("Page not found");
  const host = String(req.headers.host || "");
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return res.status(400).send("Invalid host");

  try {
    const protocol = req.headers["x-forwarded-proto"] === "http" ? "http" : "https";
    const templateResponse = await fetch(`${protocol}://${host}/index.html`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!templateResponse.ok) throw new Error(`HTML template returned ${templateResponse.status}`);
    let html = await templateResponse.text();
    const rootPattern = /<div id="root">[\s\S]*?<\/div>/i;
    if (!rootPattern.test(html)) throw new Error("HTML template has no root element");

    const url = `${SITE_URL}${page.path}`;
    const title = `${page.title} | Shades World`;
    const head = `<link rel="canonical" href="${escapeHtml(url)}" />`
      + `<meta property="og:type" content="website" />`
      + `<meta property="og:site_name" content="Shades World" />`
      + `<meta property="og:title" content="${escapeHtml(title)}" />`
      + `<meta property="og:description" content="${escapeHtml(page.description)}" />`
      + `<meta property="og:url" content="${escapeHtml(url)}" />`
      + `<meta name="twitter:card" content="summary" />`;
    const links = page.links.map((path) =>
      `<li><a href="${escapeHtml(path)}">${escapeHtml(path === "/shop" ? "Shop all sunglasses" : collections[path.split("/").pop()]?.[0] || path)}</a></li>`).join("");
    const content = `<main><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.description)}</p>`
      + (links ? `<nav aria-label="Explore more"><ul>${links}</ul></nav>` : "") + `</main>`;
    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`)
      .replace(/<meta\s+name="description"[^>]*>/i,
        `<meta name="description" content="${escapeHtml(page.description)}" />`)
      .replace(/<link\s+rel="canonical"[^>]*>/i, "")
      .replace(/<meta\s+property="og:[^"]+"[^>]*>/gi, "")
      .replace(/<meta\s+name="twitter:card"[^>]*>/gi, "")
      .replace("</head>", `${head}</head>`)
      .replace(rootPattern, `<div id="root">${content}</div>`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).send(req.method === "HEAD" ? "" : html);
  } catch (error) {
    res.setHeader("Retry-After", "120");
    return res.status(503).send("Page temporarily unavailable");
  }
};
