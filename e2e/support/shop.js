const { expect } = require("@playwright/test");
const { markDelivered, orderStatus } = require("./fixtures");
const { sqlValue } = require("./api");
const { fillCheckoutAddress } = require("./ui");

/**
 * The one shopping-flow helper for the whole E2E suite.
 *
 * This module exists because the add-to-bag → checkout sequence had been copy-pasted into four
 * specs and three of the copies drifted: they navigated away from the product page before the
 * server-side POST /cart/items had landed, so checkout loaded an empty cart and the test failed
 * intermittently. Patching each copy fixed the symptom; having one copy is what stops it
 * recurring. Every spec that buys something must call these — do not re-inline the sequence.
 */

/**
 * Adds a variant to the bag from the product page and does not return until the server has it.
 *
 * The wait is the whole point. For a signed-in shopper the add is optimistic in React *and* a POST
 * to the API; the cart badge updates from the optimistic half immediately, so waiting on the badge
 * alone proves nothing. A navigation at that moment aborts the in-flight POST and the server-side
 * cart stays empty.
 */
const addToBag = async (page, { productId, colour, quantity = 1, expectedBadge } = {}) => {
  await page.goto(`/product/${productId}`);
  if (colour) await page.locator(".pd-variant-options button", { hasText: colour }).click();
  for (let index = 0; index < quantity; index += 1) await page.locator(".pd-add-btn").click();
  if (expectedBadge !== undefined) await expect(page.locator(".cart-badge")).toHaveText(String(expectedBadge));
  // Settles the optimistic-vs-persisted gap described above.
  await page.waitForLoadState("networkidle");
};

/**
 * Completes checkout for whatever is currently in the bag and waits for the order to exist.
 * Asserts the checkout actually sees a non-empty bag first, so a lost cart fails here with an
 * obvious message instead of as a mystifying "button never became enabled" timeout.
 */
const checkout = async (page, { account, pincode = "560001", country = "India" } = {}) => {
  await page.goto("/order");
  await expect(page.locator(".checkout-pay-btn"),
    "checkout should see a non-empty bag — an empty one means an add-to-cart POST was lost")
    .not.toContainText("₹0", { timeout: 20_000 });
  // A customer who has checked out before already has a saved address, so PlaceOrder shows the
  // saved-address picker instead of the new-address form and there is nothing to fill. Filling
  // unconditionally is what made a second checkout for the same account time out on a field that
  // was never rendered.
  if (await page.getByPlaceholder("Recipient name").count()) {
    await fillCheckoutAddress(page, { pincode, country });
  }
  await page.locator(".checkout-confirm input[type=checkbox]").check();
  // PlaceOrder unticks the confirm box whenever the total changes, and the total moves again when
  // the catalogue request resolves after the cart one. Waiting for the button to enable turns a
  // 15s "never became clickable" timeout into an assertion that says what went wrong.
  await expect(page.locator(".checkout-pay-btn"),
    "pay button should enable once the bag and catalogue have settled").toBeEnabled({ timeout: 20_000 });
  await page.locator(".checkout-pay-btn").click();
  await expect(page).toHaveURL(/my-orders/, { timeout: 30_000 });
  // Scoped to the buyer. A global MAX(ORDER_ID) silently returns another test's order the moment
  // anything else places one — which is exactly what happens if workers is ever raised above 1.
  return account
    ? Number(sqlValue(`SELECT MAX(ORDER_ID) FROM ORDERS WHERE USER_ID=${Number(account.userId)}`))
    : Number(sqlValue("SELECT MAX(ORDER_ID) FROM ORDERS"));
};

/** Buy one variant end to end. Returns the order id. */
const buy = async (page, { productId, colour, quantity = 1, account, pincode, country } = {}) => {
  await addToBag(page, { productId, colour, quantity, expectedBadge: quantity });
  return checkout(page, { account, pincode, country });
};

/** Buy one variant and drive the order to DELIVERED, which is what a review or return needs. */
const buyAndDeliver = async (page, options = {}) => {
  const orderId = await buy(page, options);
  expect(await markDelivered(orderId), `order ${orderId} should reach DELIVERED`).toBe("DELIVERED");
  return orderId;
};

module.exports = { addToBag, buy, buyAndDeliver, checkout, orderStatus };
