const API_URL = process.env.REACT_APP_API_URL || "http://localhost:8080/api";
let csrfToken = null;
let csrfPromise = null;
let refreshPromise = null;

const parseResponse = async (response) => {
  // 204 and other empty bodies are legitimate successes, not parse failures.
  if (response.status === 204) return null;
  let payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || "Something went wrong. Please try again.");
    error.status = response.status;
    // The backend answers a bean-validation failure with a DELIBERATELY generic `message`
    // ("One or more fields have validation errors") and puts the useful part — one message per
    // field — in `validationErrors`. Reading only `message` is what made registration tell a
    // customer that something was wrong without ever saying what. Carrying the map here lets a
    // form put each message against its own input; forms that ignore it are unaffected.
    if (payload?.validationErrors && typeof payload.validationErrors === "object") {
      error.validationErrors = payload.validationErrors;
    }
    throw error;
  }
  if (payload?.content && payload?.page) payload = { ...payload, ...payload.page };
  return payload;
};

const csrf = async (force = false) => {
  if (force) csrfToken = null;
  if (csrfToken) return csrfToken;
  // One CSRF response sets both the readable cookie and the value used in the
  // request header. Concurrent fetches can return different tokens, so all
  // callers must share the same in-flight request.
  if (!csrfPromise) {
    csrfPromise = fetch(`${API_URL}/auth/csrf`, { credentials: "include" })
      .then(parseResponse)
      .then((payload) => {
        csrfToken = payload.token;
        return csrfToken;
      })
      .finally(() => { csrfPromise = null; });
  }
  return csrfPromise;
};

const request = async (path, options = {}) => {
  const method = (options.method || "GET").toUpperCase();
  const headers = { ...(options.headers || {}) };
  const retryUnauthorizedCsrf = options.retryUnauthorizedCsrf === true;
  const fetchOptions = { ...options };
  delete fetchOptions.retryUnauthorizedCsrf;
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(method);
  // Spring may replace the readable CSRF cookie after an unsafe response.
  // Synchronize immediately before every write instead of reusing a token
  // cached by an earlier profile/preferences save.
  if (unsafe) headers["X-XSRF-TOKEN"] = await csrf(true);
  const send = () => fetch(`${API_URL}${path}`, { ...fetchOptions, headers: { ...headers }, credentials: "include" });
  let response = await send();
  // Depending on where rejection occurs in the security chain, a stale CSRF
  // pair can surface as either 401 or 403. Re-synchronize once before treating
  // a 401 as an expired access token.
  if (unsafe && (response.status === 403 || (response.status === 401 && retryUnauthorizedCsrf))) {
    headers["X-XSRF-TOKEN"] = await csrf(true);
    response = await send();
  }
  if (unsafe) csrfToken = null;
  return response;
};

export const login = async (email, password) => {
  const response = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const payload = await parseResponse(response);
  csrfToken = null;
  return payload;
};

export const register = async ({ name, email, password, phoneNumber }) => {
  const response = await request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password, phoneNumber: phoneNumber || null }),
  });
  return parseResponse(response);
};

export const forgotPassword = async (email) => {
  const response = await request("/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return parseResponse(response);
};

export const resetPassword = async (token, newPassword) => {
  const response = await request("/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
  return parseResponse(response);
};

export const verifyEmail = async (token) => {
  const response = await request("/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return parseResponse(response);
};

export const resendVerification = async (email) => {
  const response = await request("/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return parseResponse(response);
};

export const googleLogin = async (credential) => {
  const response = await request("/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  const payload = await parseResponse(response);
  csrfToken = null;
  return payload;
};

export const refreshAccessToken = async () => {
  const refresh = async () => {
    const response = await request("/auth/refresh", { method: "POST" });
    const payload = await parseResponse(response);
    csrfToken = null;
    return payload;
  };
  return navigator.locks?.request
    ? navigator.locks.request("shades-world-auth-refresh", refresh)
    : refresh();
};

export const getCurrentUser = async () => {
  const response = await request("/auth/me");
  return parseResponse(response);
};

export const updateCurrentUser = (accessToken, profile) =>
  authenticatedRequest("/auth/me", accessToken, { method: "PUT", body: JSON.stringify(profile) });

export const getCommunicationPreferences = (accessToken) =>
  authenticatedRequest("/communication-preferences", accessToken);

export const updateCommunicationPreferences = (accessToken, preferences) =>
  authenticatedRequest("/communication-preferences", accessToken, { method: "PUT", body: JSON.stringify(preferences) });

/**
 * The whole active catalogue, as one list.
 *
 * Pages through the endpoint rather than asking for one big page, because 200 is not a generous
 * ceiling this side of the wire — it is the server's hard limit. PaginationConfig calls
 * setMaxPageSize(200), so `size=500` is silently clamped and comes back with 200 rows and no
 * indication that anything was left behind. The old single `size=200` request therefore capped the
 * shop at 200 products: with a 256-product catalogue the home grid showed 200 styles, and the
 * Men/Women/Unisex filters counted 47/54/97 against a real 57/72/124. Nothing errored — the
 * missing 56 products simply did not exist as far as the storefront was concerned.
 *
 * This is the same class of bug as the one getProductBySlug below was written to fix, which was
 * repaired only for the product page. The listing had the same ceiling and kept it.
 *
 * `page.totalPages` is the loop's authority rather than "keep going until a short page", so a
 * catalogue that happens to be an exact multiple of the page size does not need a wasted extra
 * request to discover it has ended. The sort is fixed and total-ordering (productId), which is what
 * makes paging safe: an unstable or non-unique ordering can show the same row on two pages and drop
 * another entirely.
 */
export const getStoreProducts = async () => {
  const PAGE_SIZE = 200;
  const first = await parseResponse(await fetch(`${API_URL}/products?size=${PAGE_SIZE}&page=0&sort=productId,desc`));
  const totalPages = first?.totalPages ?? first?.page?.totalPages ?? 1;
  if (totalPages <= 1) return first;

  const content = [...(first.content || [])];
  for (let page = 1; page < totalPages; page += 1) {
    const next = await parseResponse(await fetch(`${API_URL}/products?size=${PAGE_SIZE}&page=${page}&sort=productId,desc`));
    content.push(...(next.content || []));
  }
  // Same shape as a single-page response, so every caller keeps reading `.content`. The pagination
  // fields are rewritten to describe THIS list rather than left at page 0 of N — including the
  // nested `page` object parseResponse flattens, which would otherwise still claim 2 pages and
  // hand a later reader a number that stopped being true here.
  const pagination = { size: content.length, number: 0, totalPages: 1, totalElements: content.length };
  return { ...first, ...pagination, page: pagination, content, numberOfElements: content.length };
};

/**
 * One product by its public slug.
 *
 * The product page used to resolve its product out of the 200-item list above with
 * product_list.find(...), which meant a direct hit on a product outside that window rendered
 * "Product not found" — reproducible on any catalogue over 200 products. The page now asks the
 * server for exactly the product in the URL, so direct navigation, refresh and Back/Forward work
 * regardless of catalogue size, and the listing fetch is no longer load-bearing for it.
 */
export const getProductBySlug = async (slug) => {
  const response = await fetch(`${API_URL}/products/slug/${encodeURIComponent(slug)}`);
  return parseResponse(response);
};

/** The canonical slug for a legacy numeric /product/{id} link, so it can be redirected. */
export const getCanonicalProductSlug = async (productId) => {
  const response = await fetch(`${API_URL}/products/${encodeURIComponent(productId)}/canonical`);
  return parseResponse(response);
};

/**
 * The Best Sellers ranking. Public, so no credentials.
 *
 * Returns [{ product, soldQuantity, soldRevenue }] already ordered by the server — the order is
 * the answer, so callers must not re-sort it. Eligibility, refund handling and tie-breaking all
 * live in ProductRepository.findBestSellers; the client only renders what it is given.
 */
export const getBestSellers = async (limit = 20) => {
  const response = await fetch(`${API_URL}/products/best-sellers?limit=${encodeURIComponent(limit)}`);
  return parseResponse(response);
};

/**
 * Signing out is idempotent by definition: the goal is "this browser no longer holds a session",
 * and a server that rejects the call because the session or CSRF pair is already gone has, in
 * effect, already achieved that.
 *
 * The endpoint is permitAll, so a dead session still returns 200. The rejection that surfaced as
 * "Something went wrong. Please try again." is a CSRF failure — a missing XSRF cookie or a token
 * that no longer matches it both return **401 with an empty body**, and parseResponse turns an
 * empty error body into that generic message. Every other unsafe call opts into the 401 retry via
 * retryUnauthorizedCsrf; logout did not, so it threw where the others recovered.
 *
 * 5xx and network failures are still surfaced, so a genuinely broken backend is not hidden.
 */
export const logout = async () => {
  try {
    const response = await request("/auth/logout", {
      method: "POST",
      retryUnauthorizedCsrf: true,
    });
    csrfToken = null;
    // 401/403 here means the session or its CSRF pair is already gone — the desired end state.
    if (response.status === 401 || response.status === 403) {
      return { message: "Already signed out" };
    }
    return await parseResponse(response);
  } catch (error) {
    csrfToken = null;
    throw error;
  }
};

const authenticatedRequest = async (path, accessToken, options = {}) => {
  const execute = () => request(path, {
    ...options,
    retryUnauthorizedCsrf: true,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let response = await execute();
  if (response.status === 401) {
    if (!refreshPromise) refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
    await refreshPromise;
    response = await execute();
  }
  return parseResponse(response);
};

export const downloadInvoice = async (accessToken, orderId, admin = false) => {
  const path = admin ? `/orders/admin/${orderId}/invoice` : `/orders/${orderId}/invoice`;
  const response = await request(path);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "The invoice could not be downloaded.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `shades-world-invoice-${orderId}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const getNotifications = (accessToken, page = 0) =>
  authenticatedRequest(`/notifications?page=${page}&size=30&sort=createdAt,desc`, accessToken);

export const getUnreadNotificationCount = (accessToken) =>
  authenticatedRequest("/notifications/unread-count", accessToken);

export const markNotificationRead = (accessToken, notificationId) =>
  authenticatedRequest(`/notifications/${notificationId}/read`, accessToken, { method: "PATCH" });

export const markAllNotificationsRead = (accessToken) =>
  authenticatedRequest("/notifications/read-all", accessToken, { method: "PATCH" });

export const getCoupons = (accessToken) =>
  authenticatedRequest("/coupons?size=100&sort=couponId,desc", accessToken);

export const createCoupon = (accessToken, coupon) =>
  authenticatedRequest("/coupons", accessToken, {
    method: "POST",
    body: JSON.stringify(coupon),
  });

export const updateCoupon = (accessToken, couponId, coupon) =>
  authenticatedRequest(`/coupons/${couponId}`, accessToken, {
    method: "PUT",
    body: JSON.stringify(coupon),
  });

export const validateCoupon = (accessToken, couponCode) =>
  authenticatedRequest("/coupons/validate", accessToken, {
    method: "POST",
    body: JSON.stringify({ couponCode }),
  });

// ── Automatic quantity offer ─────────────────────────────────────────────────────────────────
//
// Two public reads and an admin CRUD set. The public pair deliberately does not go through
// authenticatedRequest: the banner renders for a signed-out visitor and a guest bag has to be
// priceable, so neither may require a token. They still go through `request`, which supplies the
// CSRF header the quote POST needs.

/** The offer in force right now. Resolves to {active:false} rather than throwing when there is none. */
export const getActiveAutomaticOffer = async () => {
  const response = await request("/offers/automatic/active");
  return parseResponse(response);
};

/**
 * Asks the server what a cart costs.
 *
 * `lines` carries variant ids and quantities only. The response's totalAmount is the number
 * checkout sends back as expectedTotalAmount, so the estimate the customer confirms and the amount
 * the server will charge are the same figure computed once, on the server, from current prices.
 */
export const quoteCart = async (lines, { couponCode } = {}) => {
  const query = couponCode ? `?couponCode=${encodeURIComponent(couponCode)}` : "";
  const response = await request(`/offers/automatic/quote${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines }),
  });
  return parseResponse(response);
};

export const getAutomaticOffers = (accessToken) =>
  authenticatedRequest("/offers/automatic/admin?size=100&sort=automaticOfferId,desc", accessToken);

export const createAutomaticOffer = (accessToken, offer) =>
  authenticatedRequest("/offers/automatic/admin", accessToken, {
    method: "POST", body: JSON.stringify(offer),
  });

export const updateAutomaticOffer = (accessToken, offerId, offer) =>
  authenticatedRequest(`/offers/automatic/admin/${offerId}`, accessToken, {
    method: "PUT", body: JSON.stringify(offer),
  });

/** `version` is required: the server answers 409 if the offer moved on since it was loaded. */
export const setAutomaticOfferActive = (accessToken, offerId, active, version) =>
  authenticatedRequest(
    `/offers/automatic/admin/${offerId}/active?active=${active}&version=${version}`,
    accessToken, { method: "PATCH" });

export const archiveAutomaticOffer = (accessToken, offerId) =>
  authenticatedRequest(`/offers/automatic/admin/${offerId}`, accessToken, { method: "DELETE" });

export const setCouponActive = (accessToken, couponId, active) =>
  authenticatedRequest(`/coupons/${couponId}/active?active=${active}`, accessToken, { method: "PATCH" });

export const deactivateCoupon = async (accessToken, couponId) => {
  const response = await request(`/coupons/${couponId}`, {
    method: "DELETE",
  });
  if (!response.ok) return parseResponse(response);
};

export const getAdminProducts = (accessToken) =>
  authenticatedRequest("/products/admin/all?size=200&sort=productId,desc", accessToken);

/** One product, fresh — how the wizard resyncs after an image or variant operation. */
export const getProductById = async (productId) => {
  const response = await fetch(`${API_URL}/products/${productId}`);
  return parseResponse(response);
};

export const getCategories = async () => {
  const response = await fetch(`${API_URL}/categories`);
  return parseResponse(response);
};

export const createProduct = (accessToken, product) =>
  authenticatedRequest("/products", accessToken, { method: "POST", body: JSON.stringify(product) });

export const updateProduct = (accessToken, productId, product) =>
  authenticatedRequest(`/products/${productId}`, accessToken, { method: "PUT", body: JSON.stringify(product) });

export const setProductActive = (accessToken, productId, active) =>
  authenticatedRequest(`/products/${productId}/active?active=${active}`, accessToken, { method: "PATCH" });

export const removeProduct = (accessToken, productId) =>
  authenticatedRequest(`/products/${productId}`, accessToken, { method: "DELETE" });

export const addProductVariant = (accessToken, productId, variant) =>
  authenticatedRequest(`/products/${productId}/variants`, accessToken, { method: "POST", body: JSON.stringify(variant) });

export const deleteProductVariant = (accessToken, productId, variantId) =>
  authenticatedRequest(`/products/${productId}/variants/${variantId}`, accessToken, { method: "DELETE" });

/** Archive (false) or restore (true) one variant — the safe alternative to deleting sold stock. */
export const setProductVariantActive = (accessToken, productId, variantId, active) =>
  authenticatedRequest(`/products/${productId}/variants/${variantId}/active?active=${active}`, accessToken,
    { method: "PATCH" });

/** The deliberate "Set as Main Variant" workflow: moves the variant to position 1. */
export const setMainProductVariant = (accessToken, productId, variantId) =>
  authenticatedRequest(`/products/${productId}/variants/${variantId}/main`, accessToken, { method: "PUT" });

export const addProductImage = (accessToken, productId, image) =>
  authenticatedRequest(`/products/${productId}/images`, accessToken, { method: "POST", body: JSON.stringify(image) });

export const uploadProductImage = (accessToken, productId, file, metadata = {}) => {
  const form = new FormData();
  form.append("file", file);
  form.append("altText", metadata.altText || "");
  form.append("displayOrder", String(metadata.displayOrder || 0));
  form.append("isPrimary", String(Boolean(metadata.isPrimary)));
  if (metadata.variantId) form.append("variantId", String(metadata.variantId));
  return authenticatedRequest(`/products/${productId}/images/upload`, accessToken, { method: "POST", body: form });
};

export const deleteProductImage = (accessToken, productId, imageId) =>
  authenticatedRequest(`/products/${productId}/images/${imageId}`, accessToken, { method: "DELETE" });

/**
 * Replace the whole gallery order in one call, rather than sending a move per image. Two admins
 * dragging at the same time then resolve to one of the two orders they each saw, instead of
 * interleaving into a third that neither chose.
 */
export const reorderProductImages = (accessToken, productId, imageIdsInOrder) =>
  authenticatedRequest(`/products/${productId}/images/order`, accessToken, {
    method: "PUT", body: JSON.stringify(imageIdsInOrder),
  });

export const setPrimaryProductImage = (accessToken, productId, imageId) =>
  authenticatedRequest(`/products/${productId}/images/${imageId}/primary`, accessToken, { method: "PUT" });

export const updateProductImage = (accessToken, productId, imageId, changes) =>
  authenticatedRequest(`/products/${productId}/images/${imageId}`, accessToken, {
    method: "PATCH", body: JSON.stringify(changes),
  });

export const adjustInventory = (accessToken, variantId, quantity, movementType, reason) => {
  return authenticatedRequest(`/inventory/variants/${variantId}/adjust`, accessToken, {
    method: "POST", body: JSON.stringify({ quantity: Number(quantity), movementType, reason }),
  });
};

export const updateLowStockThreshold = (accessToken, variantId, lowStockThreshold) =>
  authenticatedRequest(`/inventory/variants/${variantId}/threshold`, accessToken, {
    method: "PATCH", body: JSON.stringify({ lowStockThreshold: Number(lowStockThreshold) }),
  });

export const getAdminOrders = (accessToken) =>
  authenticatedRequest("/orders/admin/all?size=200", accessToken);

export const updateAdminOrderStatus = (accessToken, orderId, status, notes) =>
  authenticatedRequest(`/orders/admin/${orderId}/status`, accessToken, {
    method: "PATCH", body: JSON.stringify({ status, notes }),
  });

export const createShipment = (accessToken, orderId, shipment) =>
  authenticatedRequest(`/shipments/orders/${orderId}`, accessToken, {
    method: "POST", body: JSON.stringify(shipment),
  });

export const updateShipmentStatus = (accessToken, shipmentId, status) =>
  authenticatedRequest(`/shipments/${shipmentId}/status`, accessToken, {
    method: "PATCH", body: JSON.stringify({ status }),
  });

export const getInventoryMovements = (accessToken, variantId) =>
  authenticatedRequest(`/inventory/variants/${variantId}/movements?size=100`, accessToken);

export const getAdminCustomers = (accessToken) =>
  authenticatedRequest("/admin/customers?size=200", accessToken);

export const setCustomerActive = (accessToken, userId, active) =>
  authenticatedRequest(`/admin/customers/${userId}/active?active=${active}`, accessToken, { method: "PATCH" });

export const getEmailOutbox = (accessToken, { status = "", search = "", page = 0, size = 25 } = {}) => {
  const params = new URLSearchParams({ page, size, sort: "createdAt,desc" });
  if (status) params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  return authenticatedRequest(`/admin/email-outbox?${params}`, accessToken);
};

export const getEmailOutboxSummary = (accessToken) =>
  authenticatedRequest("/admin/email-outbox/summary", accessToken);

export const retryEmailOutbox = (accessToken, emailOutboxId) =>
  authenticatedRequest(`/admin/email-outbox/${emailOutboxId}/retry`, accessToken, { method: "POST" });

export const getProductReviews = async (productId) => {
  const response = await fetch(`${API_URL}/reviews/products/${productId}?size=100&sort=createdAt,desc`);
  return parseResponse(response);
};

export const getMyProductReview = (accessToken, productId) =>
  authenticatedRequest(`/reviews/products/${productId}/mine`, accessToken);
export const getReviewableVariants = (accessToken, productId) =>
  authenticatedRequest(`/reviews/products/${productId}/reviewable-variants`, accessToken);

export const createReview = (accessToken, review) =>
  authenticatedRequest("/reviews", accessToken, { method: "POST", body: JSON.stringify(review) });

export const updateReview = (accessToken, reviewId, review) =>
  authenticatedRequest(`/reviews/${reviewId}`, accessToken, { method: "PUT", body: JSON.stringify(review) });

export const deleteReview = (accessToken, reviewId) =>
  authenticatedRequest(`/reviews/${reviewId}`, accessToken, { method: "DELETE" });

export const getAdminReviews = (accessToken, { status = "", search = "", page = 0 } = {}) => {
  const params = new URLSearchParams({ page, size: 50, sort: "createdAt,desc" });
  if (status) params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  return authenticatedRequest(`/reviews/admin?${params}`, accessToken);
};

export const moderateReview = (accessToken, reviewId, status) =>
  authenticatedRequest(`/reviews/admin/${reviewId}/status`, accessToken, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

export const getMyOrders = (accessToken) =>
  authenticatedRequest("/orders?size=100&sort=purchasedAt,desc", accessToken);
export const cancelOrder = (accessToken, orderId) =>
  authenticatedRequest(`/orders/${orderId}/cancel`, accessToken, { method: "POST" });

export const getCart = (accessToken) => authenticatedRequest("/cart", accessToken);
export const addCartItem = (accessToken, variantId, quantity = 1) =>
  authenticatedRequest("/cart/items", accessToken, { method: "POST", body: JSON.stringify({ variantId, quantity }) });
export const updateCartItem = (accessToken, variantId, quantity) =>
  authenticatedRequest(`/cart/items/${variantId}?quantity=${encodeURIComponent(quantity)}`, accessToken, { method: "PUT" });
export const removeCartItem = (accessToken, variantId) =>
  authenticatedRequest(`/cart/items/${variantId}`, accessToken, { method: "DELETE" });
export const getAddresses = (accessToken) => authenticatedRequest("/addresses", accessToken);
export const createAddress = (accessToken, address) =>
  authenticatedRequest("/addresses", accessToken, { method: "POST", body: JSON.stringify(address) });
export const updateAddress = (accessToken, addressId, address) =>
  authenticatedRequest(`/addresses/${addressId}`, accessToken, { method: "PUT", body: JSON.stringify(address) });
export const deleteAddress = (accessToken, addressId) =>
  authenticatedRequest(`/addresses/${addressId}`, accessToken, { method: "DELETE" });
export const setDefaultAddress = (accessToken, addressId) =>
  authenticatedRequest(`/addresses/${addressId}/default`, accessToken, { method: "PATCH" });
export const createOrder = (accessToken, order) =>
  authenticatedRequest("/orders", accessToken, { method: "POST", body: JSON.stringify(order) });
export const processMockPayment = (accessToken, orderId) =>
  authenticatedRequest(`/payments/orders/${orderId}`, accessToken, {
    method: "POST", body: JSON.stringify({ paymentMethod: "MOCK" }),
  });

export const getMyReturns = (accessToken) => authenticatedRequest("/returns?size=100", accessToken);
export const createReturn = (accessToken, request) => authenticatedRequest("/returns", accessToken, { method: "POST", body: JSON.stringify(request) });
export const cancelReturn = (accessToken, returnId) => authenticatedRequest(`/returns/${returnId}/cancel`, accessToken, { method: "PATCH" });
export const getAdminReturns = (accessToken) => authenticatedRequest("/returns/admin/all?size=200", accessToken);
export const updateReturnStatus = (accessToken, returnId, status, adminComments, itemConditions) => authenticatedRequest(`/returns/admin/${returnId}/status`, accessToken, { method: "PATCH", body: JSON.stringify({ status, adminComments, itemConditions }) });
export const processRefund = (accessToken, paymentId, refundAmount, reason, returnId) => authenticatedRequest(`/refunds/payments/${paymentId}`, accessToken, { method: "POST", body: JSON.stringify({ refundAmount, reason, returnId }) });
export const getWishlist = (accessToken) => authenticatedRequest("/wishlists", accessToken);
export const addWishlistItem = (accessToken, productId) => authenticatedRequest(`/wishlists/items/${productId}`, accessToken, { method: "POST" });
export const removeWishlistItem = (accessToken, productId) => authenticatedRequest(`/wishlists/items/${productId}`, accessToken, { method: "DELETE" });

// ── Storefront appearance, administrator-controlled ───────────────────────────────────────────
// The settings read is public and unauthenticated: the hero image is the first thing on the home
// page, so it has to resolve for a signed-out visitor. Everything that writes goes through
// authenticatedRequest under /admin/storefront.
export const getStorefrontSettings = async () => {
  const response = await fetch(`${API_URL}/storefront/settings`);
  return parseResponse(response);
};
export const getCuratedBestSellers = (accessToken) =>
  authenticatedRequest("/admin/storefront/best-sellers", accessToken);
export const saveCuratedBestSellers = (accessToken, productIds) =>
  authenticatedRequest("/admin/storefront/best-sellers", accessToken, {
    method: "PUT", body: JSON.stringify({ productIds }),
  });
export const uploadHeroImage = (accessToken, file) => {
  const form = new FormData();
  form.append("file", file);
  return authenticatedRequest("/admin/storefront/hero-image", accessToken, { method: "POST", body: form });
};
export const resetHeroImage = (accessToken) =>
  authenticatedRequest("/admin/storefront/hero-image", accessToken, { method: "DELETE" });
// Collection name in the path, encoded: it is server-validated against a fixed list of four, so an
// unknown one is a 400 rather than a silently created CONFIG row.
export const uploadCollectionImage = (accessToken, collection, file) => {
  const form = new FormData();
  form.append("file", file);
  return authenticatedRequest(
    `/admin/storefront/collection-image/${encodeURIComponent(collection)}`,
    accessToken, { method: "POST", body: form });
};
export const resetCollectionImage = (accessToken, collection) =>
  authenticatedRequest(
    `/admin/storefront/collection-image/${encodeURIComponent(collection)}`,
    accessToken, { method: "DELETE" });
