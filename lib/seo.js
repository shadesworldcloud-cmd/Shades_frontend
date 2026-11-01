const SITE_URL = (process.env.SEO_SITE_URL || "https://shades-frontend-drab.vercel.app").replace(/\/$/, "");
const API_URL = (process.env.SEO_API_URL || "https://shades-backend-5y1z.onrender.com/api").replace(/\/$/, "");

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

const plainText = (value) => String(value ?? "").replace(/<[^>]*>/g, " ")
  .replace(/\s+/g, " ").trim();

const snippet = (value, maxLength = 160) => {
  const text = plainText(value);
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength + 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") || maxLength).trimEnd()}…`;
};

const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

const fetchJson = async (path) => {
  const response = await fetch(`${API_URL}${path}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    const error = new Error(`Catalog API returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
};

const publicImage = (image) => String(image?.imageUrl || "").split("#", 1)[0];

const primaryVariant = (product) => product.variants?.find((variant) => variant.mainVariant)
  || product.variants?.find((variant) => variant.isActive && variant.quantityAvailable > 0)
  || product.variants?.[0];

const primaryImage = (product, variant) => product.images?.find((image) =>
  image.variantId === variant?.variantId && image.isPrimary)
  || product.images?.find((image) => image.variantId === variant?.variantId)
  || product.images?.[0];

module.exports = {
  SITE_URL, API_URL, escapeHtml, plainText, snippet, safeJson, fetchJson,
  publicImage, primaryVariant, primaryImage,
};
