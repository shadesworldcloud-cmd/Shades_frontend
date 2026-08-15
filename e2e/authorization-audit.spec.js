const { test, expect } = require("@playwright/test");
const { createCustomer, sqlValue } = require("./support/api");
const { createProduct, markDelivered } = require("./support/fixtures");
const { signInAsNewCustomer } = require("./support/ui");
const { buy } = require("./support/shop");

// The brief is explicit that changing the shape of a URL is not a security control: "Never rely on
// an unguessable URL as the security control." So this audits the control that actually matters —
// whether every per-customer endpoint enforces ownership on the server, independently of what the
// URL looks like.
//
// The method is deliberately blunt: create two real customers, have A create real records, then
// have B ask for them by their real numeric ids. Anything B can read or change is a horizontal
// privilege escalation and fails the test. Guests are checked the same way.
//
// This is worth running whether or not product URLs ever change shape, because it is testing the
// thing the URL format was never protecting in the first place.

let alice;
let bob;
let product;
let aliceOrderId;
let aliceAddressId;

test.beforeAll(async () => {
  product = await createProduct({
    name: `E2E Authz ${Date.now()}`,
    variants: [{ sku: `AZ-${Date.now()}`, variantName: "Onyx", color: "Onyx", price: 1500, quantityAvailable: 20 }],
  });
  alice = await createCustomer("authz-alice");
  bob = await createCustomer("authz-bob");
});

/**
 * Alice's address, created through the API and owned by her.
 *
 * Created per test rather than carried over from an earlier one. Sharing state between Playwright
 * tests is fragile — when the producing test's value did not land, the consuming test sent
 * `/addresses/NaN` and got a 400 for a malformed path variable, which reads exactly like an
 * authorization result and is not one. A self-contained fixture cannot lie in that way.
 */
const aliceAddress = async () => {
  const saved = await alice.client.post("/addresses", {
    addressType: "SHIPPING", recipientName: "Alice Owner", addressLine1: "1 Owner Street",
    city: "Bengaluru", state: "Karnataka", pincode: "560001", country: "India", isDefault: false,
  });
  expect(Number(saved.addressId), "the fixture address really exists").toBeGreaterThan(0);
  return Number(saved.addressId);
};

test("customer A creates the order this audit will try to reach", async ({ page }) => {
  // Driven through the real UI so the record is exactly what a customer would produce.
  const account = await signInAsNewCustomer(page, "authz-owner");
  alice = account;
  aliceOrderId = await buy(page, { productId: product.productId, account });
  expect(aliceOrderId).toBeGreaterThan(0);
});

test("customer B cannot read or change customer A's order", async () => {
  const denied = async (call, what) => {
    const failure = await call().then(() => null).catch((error) => error);
    expect(failure, `${what} must not succeed for another customer`).not.toBeNull();
    // 403 or 404 are both acceptable; 200 is not. 404 additionally avoids confirming existence.
    expect([401, 403, 404], `${what} returned ${failure.status}`).toContain(failure.status);
  };

  await denied(() => bob.client.get(`/orders/${aliceOrderId}`), "reading the order");
  await denied(() => bob.client.post(`/orders/${aliceOrderId}/cancel`), "cancelling the order");
  await denied(() => bob.client.get(`/orders/${aliceOrderId}/invoice`), "downloading the invoice");

  // And the order is untouched.
  expect(sqlValue(`SELECT ORDER_STATUS FROM ORDERS WHERE ORDER_ID = ${aliceOrderId}`)).not.toBe("CANCELLED");
});

test("customer B cannot reach customer A's addresses", async () => {
  aliceAddressId = await aliceAddress();
  const failure = await bob.client.put(`/addresses/${aliceAddressId}`, {
    addressType: "SHIPPING", recipientName: "Hijacked", addressLine1: "1 Evil Street",
    city: "Nowhere", state: "Nowhere", pincode: "560001", country: "India",
  }).then(() => null).catch((error) => error);
  expect(failure, "updating another customer's address must fail").not.toBeNull();
  expect([401, 403, 404]).toContain(failure.status);
  expect(sqlValue(`SELECT RECIPIENT_NAME FROM ADDRESSES WHERE ADDRESS_ID = ${aliceAddressId}`))
    .not.toBe("Hijacked");

  const deletion = await bob.client.del(`/addresses/${aliceAddressId}`).then(() => null).catch((error) => error);
  expect(deletion, "deleting another customer's address must fail").not.toBeNull();
  expect(Number(sqlValue(`SELECT COUNT(*) FROM ADDRESSES WHERE ADDRESS_ID = ${aliceAddressId}`)),
    "the address must still exist").toBe(1);
});

test("a customer's own list endpoints return only their own records", async () => {
  aliceAddressId = await aliceAddress();
  // The other half of ownership: not just "B cannot fetch A's id" but "B's own list never contains
  // A's rows", which is where a missing WHERE clause shows up.
  const orders = await bob.client.get("/orders?page=0&size=100");
  const ids = (orders.content || []).map((order) => order.orderId);
  expect(ids, "another customer's order must not appear in B's list").not.toContain(aliceOrderId);

  const addresses = await bob.client.get("/addresses");
  const addressIds = (Array.isArray(addresses) ? addresses : addresses.content || []).map((a) => a.addressId);
  expect(addressIds).not.toContain(aliceAddressId);

  const cart = await bob.client.get("/cart");
  expect(JSON.stringify(cart)).not.toContain(`"orderId":${aliceOrderId}`);
});

test("an ordinary customer cannot reach administrator endpoints", async () => {
  for (const [path, what] of [
    ["/products/admin/all", "the admin product list"],
    ["/orders/admin/all", "every customer's orders"],
    ["/admin/customers", "the customer directory"],
    ["/returns/admin/all", "every return request"],
  ]) {
    const failure = await bob.client.get(path).then(() => null).catch((error) => error);
    expect(failure, `${what} must be refused to a customer`).not.toBeNull();
    expect([401, 403], `${path} returned ${failure.status}`).toContain(failure.status);
  }
});

test("a guest cannot reach anything owned by a customer", async ({ page }) => {
  // A brand-new client with no session at all.
  const { ApiClient } = require("./support/api");
  const guest = new ApiClient();
  for (const [path, what] of [
    [`/orders/${aliceOrderId}`, "an order"],
    ["/orders", "the order list"],
    ["/addresses", "the address book"],
    ["/cart", "a cart"],
    ["/auth/me", "the current user"],
  ]) {
    const failure = await guest.get(path).then(() => null).catch((error) => error);
    expect(failure, `a guest must not read ${what}`).not.toBeNull();
    expect([401, 403]).toContain(failure.status);
  }
  expect(page).toBeTruthy();
});

test("public product data exposes only public fields", async ({ page }) => {
  await page.goto("/");
  const body = await page.evaluate(async (id) => {
    const response = await fetch(`${window.location.origin.replace("3001", "8081")}/api/products/${id}`);
    return response.json();
  }, product.productId);

  // Nothing about cost, ownership or internal bookkeeping may ride along on a public response.
  for (const leaked of ["costPrice", "supplier", "internalNotes", "createdBy", "userId", "passwordHash"]) {
    expect(Object.keys(body), `${leaked} must not be public`).not.toContain(leaked);
  }
  expect(JSON.stringify(body)).not.toMatch(/passwordHash|PASSWORD_HASH/);
});

test("an unknown product id 404s without leaking whether it ever existed", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const response = await fetch(`${window.location.origin.replace("3001", "8081")}/api/products/999999999`);
    return { status: response.status, body: await response.text() };
  });
  expect(result.status).toBe(404);
  expect(result.body, "no stack trace or SQL in the response").not.toMatch(/Exception|\.java:|SELECT |Hibernate/);
});

test("a delivered order still cannot be reviewed by someone who did not buy it", async ({ page }) => {
  // Review eligibility is ownership too: it is gated on having bought that exact variant.
  const account = await signInAsNewCustomer(page, "authz-review");
  const orderId = await buy(page, { productId: product.productId, account });
  expect(await markDelivered(orderId)).toBe("DELIVERED");
  const [item] = await account.client.get(`/reviews/products/${product.productId}/reviewable-variants`);
  expect(item, "the buyer is eligible").toBeTruthy();

  // Bob did not buy it, so the same order item must be refused to him.
  const failure = await bob.client.post("/reviews", {
    productId: product.productId, orderItemId: item.orderItemId, rating: 5, reviewText: "Not mine.",
  }).then(() => null).catch((error) => error);
  expect(failure, "reviewing another customer's purchase must fail").not.toBeNull();
  expect([400, 403, 404]).toContain(failure.status);
});
