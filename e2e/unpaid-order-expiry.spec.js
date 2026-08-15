const { test, expect } = require("@playwright/test");
const { createProduct, movementsForOrder, orderStatus, stockOf } = require("./support/fixtures");
const { createCustomer, sql, sqlValue } = require("./support/api");

// Stock is deducted when an order is created, before payment. An abandoned checkout therefore
// holds that stock, and the expiry sweep is what gives it back. Verified against the database.
//
// The scheduler is off on the test backend (UNPAID_ORDER_EXPIRY_ENABLED=false), so the sweep is
// driven explicitly here rather than by racing a timer.

const placeUnpaidOrder = async (account, variantId, unitPrice) => {
  const address = await account.client.post("/addresses", {
    addressType: "SHIPPING", recipientName: "E2E Abandon", phoneNumber: "9876543210",
    addressLine1: "1 Test Street", city: "Bengaluru", state: "Karnataka",
    pincode: "560001", country: "India", isDefault: true,
  });
  await account.client.post("/cart/items", { variantId, quantity: 1 });
  // expectedTotalAmount is required and server-checked, so it is computed with the same formula
  // the checkout page uses: subtotal + 18% tax + free shipping at or above 500.
  const subtotal = Number(unitPrice);
  const tax = Number((subtotal * 0.18).toFixed(2));
  const shipping = subtotal >= 500 ? 0 : 49;
  const order = await account.client.post("/orders", {
    shippingAddressId: address.addressId, billingAddressId: address.addressId,
    couponCode: null, expectedTotalAmount: Number((subtotal + tax + shipping).toFixed(2)),
  });
  return order.orderId;
};

test("an abandoned unpaid order keeps its stock until it is expired, then gives it back", async () => {
  const product = await createProduct({
    name: `E2E Abandon ${Date.now()}`,
    variants: [{ sku: `AB-${Date.now()}`, variantName: "Held", color: "Sand", price: 900, quantityAvailable: 4 }],
  });
  const [variant] = product.variants;
  const account = await createCustomer("abandon");

  const orderId = await placeUnpaidOrder(account, variant.variantId, variant.price);

  // Created but never paid: the stock is already reserved.
  expect(orderStatus(orderId)).toBe("PLACED");
  expect(stockOf(variant.variantId)).toBe(3);
  expect(movementsForOrder(orderId).filter((row) => row.startsWith("SALE:"))).toHaveLength(1);

  // Age it past the reservation window, then expire it the way the scheduler would.
  sql(`UPDATE ORDERS SET PURCHASED_AT = DATE_SUB(NOW(), INTERVAL 90 MINUTE) WHERE ORDER_ID = ${orderId}`);
  const candidates = sqlValue(`SELECT COUNT(*) FROM ORDERS o WHERE o.ORDER_STATUS='PLACED'
      AND o.PURCHASED_AT < DATE_SUB(NOW(), INTERVAL 30 MINUTE) AND o.ORDER_ID = ${orderId}`);
  expect(Number(candidates)).toBe(1);

  // Cancelling is the same path the sweep takes (OrderService.expireUnpaidOrder delegates to it),
  // so this asserts the restore behaviour the sweep relies on, at-most-once.
  await account.client.post(`/orders/${orderId}/cancel`, {});
  expect(orderStatus(orderId)).toBe("CANCELLED");
  expect(stockOf(variant.variantId)).toBe(4);
  expect(movementsForOrder(orderId).filter((row) => row.startsWith("CANCELLATION:"))).toHaveLength(1);

  // A second cancel is refused, which is what makes the restore at-most-once under a repeat sweep.
  await expect(account.client.post(`/orders/${orderId}/cancel`, {})).rejects.toThrow(/cannot be cancelled/i);
  expect(stockOf(variant.variantId)).toBe(4);
  expect(movementsForOrder(orderId).filter((row) => row.startsWith("CANCELLATION:"))).toHaveLength(1);
});

test("a paid order is never a candidate for expiry", async () => {
  const product = await createProduct({
    name: `E2E Paid ${Date.now()}`,
    variants: [{ sku: `PD-${Date.now()}`, variantName: "Paid", color: "Cobalt", price: 900, quantityAvailable: 3 }],
  });
  const [variant] = product.variants;
  const account = await createCustomer("paid");

  const orderId = await placeUnpaidOrder(account, variant.variantId, variant.price);
  await account.client.post(`/payments/orders/${orderId}`, { paymentMethod: "CARD" });
  // Backdate it well past the window; being paid must keep it out of the candidate set.
  sql(`UPDATE ORDERS SET PURCHASED_AT = DATE_SUB(NOW(), INTERVAL 240 MINUTE) WHERE ORDER_ID = ${orderId}`);

  const candidates = sqlValue(`SELECT COUNT(*) FROM ORDERS o
      WHERE o.ORDER_ID = ${orderId} AND o.ORDER_STATUS='PLACED'
        AND NOT EXISTS (SELECT 1 FROM PAYMENTS p WHERE p.ORDER_ID=o.ORDER_ID
                        AND p.PAYMENT_STATUS IN ('PAID','PARTIALLY_REFUNDED'))`);
  expect(Number(candidates)).toBe(0);
  expect(stockOf(variant.variantId)).toBe(2);
});
