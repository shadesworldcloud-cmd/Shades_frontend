const { test, expect } = require("@playwright/test");
const { admin, createProduct, markDelivered } = require("./support/fixtures");
const { sqlValue } = require("./support/api");
const { fillCheckoutAddress, signInAsNewAdmin, signInAsNewCustomer } = require("./support/ui");
const { buyAndDeliver } = require("./support/shop");

// Issue 3: the Disapprove button in Admin Returns & Refunds.
// It rendered #9a3d32 text on a #923f37 background — a ~1.02:1 contrast ratio, so the label was
// invisible — because AdminProducts.css declared a global `.danger { color:#9a3d32 !important }`.

/** WCAG relative-luminance contrast ratio between two `rgb(r, g, b)` strings. */
const contrastRatio = (foreground, background) => {
  const channel = (value) => {
    const scaled = Number(value) / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (colour) => {
    const [r, g, b] = colour.match(/\d+/g).map(Number);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

/** Creates a delivered order and a REQUESTED return for it. */
const createReturnRequest = async (page, label) => {
  const product = await createProduct({
    name: `E2E Ret ${label} ${Date.now()}`,
    variants: [{ sku: `RET-${label}-${Date.now()}`, variantName: "Sable", color: "Sable", price: 900, quantityAvailable: 5 }],
  });
  const customer = await signInAsNewCustomer(page, `ret-${label}`);
  const orderId = await buyAndDeliver(page, { productId: product.productId });
  const order = await customer.client.get(`/orders/${orderId}`);
  const item = order.items[0];
  const request = await customer.client.post("/returns", {
    orderId, returnReason: "Damaged or defective", customerComments: "E2E",
    items: [{ orderItemId: item.orderItemId, quantity: 1, itemCondition: "DAMAGED", returnReason: "Damaged or defective" }],
  });
  return { returnId: request.returnId };
};

/** Signs in as an admin in a fresh context and opens a return request. */
const openAsAdmin = async (browser, returnId) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // signInAsNewAdmin is register + promote + sign-in, which is exactly what was inlined here —
  // minus the rate-limit backoff, which is the only reason the helper exists.
  await signInAsNewAdmin(page, `ret-admin-${returnId}`);
  await page.locator(".admin-sidebar nav button", { hasText: "Returns & refunds" }).click();
  await page.locator(".returns-list > button", { hasText: `Return #${returnId}` }).click();
  await expect(page.locator(".return-drawer")).toBeVisible();
  return { context, page };
};

test("Approve and Disapprove are both readable, aligned and keyboard reachable at desktop and mobile", async ({ page, browser }) => {
  const { returnId } = await createReturnRequest(page, "look");
  const { context, page: adminPage } = await openAsAdmin(browser, returnId);

  for (const size of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    await adminPage.setViewportSize(size);
    const buttons = adminPage.locator(".return-actions button");
    await expect(buttons).toHaveCount(2);

    for (const name of ["APPROVED", "REJECTED"]) {
      const button = buttons.filter({ hasText: name });
      await expect(button, `${name} visible at ${size.width}px`).toBeVisible();
      const box = await button.boundingBox();
      expect(box.width, `${name} has width`).toBeGreaterThan(40);
      expect(box.height, `${name} has height`).toBeGreaterThan(20);
      // Inside the viewport, not clipped off-screen.
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);

      const style = await button.evaluate((node) => {
        const computed = getComputedStyle(node);
        return { color: computed.color, background: computed.backgroundColor, opacity: computed.opacity, visibility: computed.visibility };
      });
      expect(style.visibility).toBe("visible");
      expect(Number(style.opacity)).toBeGreaterThan(0.5);
      // The regression that started this: the label must actually be legible.
      const ratio = contrastRatio(style.color, style.background);
      expect(ratio, `${name} label contrast at ${size.width}px (was ~1.02 for REJECTED)`).toBeGreaterThanOrEqual(4.5);
    }
  }

  // Keyboard: reachable by tabbing, and the focus ring is visible when it gets there.
  // Real Tab presses, not .focus() — :focus-visible is deliberately keyboard-only, so a
  // programmatic focus would report outline:none even on a correctly styled button.
  await adminPage.setViewportSize({ width: 1280, height: 900 });
  const disapprove = adminPage.locator(".return-actions button", { hasText: "REJECTED" });
  await adminPage.locator(".return-drawer textarea").focus();
  await adminPage.keyboard.press("Tab"); // -> APPROVED
  await expect(adminPage.locator(".return-actions button", { hasText: "APPROVED" })).toBeFocused();
  await adminPage.keyboard.press("Tab"); // -> REJECTED
  await expect(disapprove).toBeFocused();
  const outline = await disapprove.evaluate((node) => {
    const computed = getComputedStyle(node);
    return { style: computed.outlineStyle, width: computed.outlineWidth };
  });
  expect(outline.style).not.toBe("none");
  expect(Number.parseFloat(outline.width)).toBeGreaterThan(0);
  await context.close();
});

test("Disapprove confirms first, then persists REJECTED through a refresh", async ({ page, browser }) => {
  const { returnId } = await createReturnRequest(page, "flow");
  const { context, page: adminPage } = await openAsAdmin(browser, returnId);

  await adminPage.locator(".return-actions button", { hasText: "REJECTED" }).click();
  const dialog = adminPage.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("rejected");
  // Nothing has been sent yet.
  expect(sqlValue(`SELECT RETURN_STATUS FROM RETURNS WHERE RETURN_ID=${returnId}`)).toBe("REQUESTED");

  // Dismissing keeps the request intact.
  await adminPage.getByRole("button", { name: "Keep request" }).click();
  await expect(dialog).toHaveCount(0);
  expect(sqlValue(`SELECT RETURN_STATUS FROM RETURNS WHERE RETURN_ID=${returnId}`)).toBe("REQUESTED");

  // Confirming sends exactly the REJECTED status.
  await adminPage.locator(".return-actions button", { hasText: "REJECTED" }).click();
  await adminPage.getByRole("button", { name: "Disapprove request" }).click();
  await expect(adminPage.locator(".admin-alert.success")).toContainText("rejected", { timeout: 20_000 });
  expect(sqlValue(`SELECT RETURN_STATUS FROM RETURNS WHERE RETURN_ID=${returnId}`)).toBe("REJECTED");

  // Persists across a full reload.
  await adminPage.reload();
  await adminPage.locator(".admin-sidebar nav button", { hasText: "Returns & refunds" }).click();
  await expect(adminPage.locator(".returns-list > button", { hasText: `Return #${returnId}` })).toContainText("REJECTED");
  await context.close();
});

test("a failed Disapprove does not show the request as disapproved", async ({ page, browser }) => {
  const { returnId } = await createReturnRequest(page, "fail");
  const { context, page: adminPage } = await openAsAdmin(browser, returnId);

  await adminPage.route("**/api/returns/admin/**", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Downstream refund service is unavailable" }) }));

  await adminPage.locator(".return-actions button", { hasText: "REJECTED" }).click();
  await adminPage.getByRole("button", { name: "Disapprove request" }).click();

  // The reason is reported inside the dialog, the dialog stays open, and nothing moved.
  await expect(adminPage.getByRole("dialog")).toContainText("Downstream refund service is unavailable", { timeout: 20_000 });
  expect(sqlValue(`SELECT RETURN_STATUS FROM RETURNS WHERE RETURN_ID=${returnId}`)).toBe("REQUESTED");

  await adminPage.getByRole("button", { name: "Keep request" }).click();
  await expect(adminPage.locator(".returns-list > button", { hasText: `Return #${returnId}` })).toContainText("REQUESTED");
  await context.close();
});

test("Approve still works and is unaffected by the Disapprove changes", async ({ page, browser }) => {
  const { returnId } = await createReturnRequest(page, "appr");
  const { context, page: adminPage } = await openAsAdmin(browser, returnId);

  // Approve applies directly — only destructive transitions are confirmed.
  await adminPage.locator(".return-actions button", { hasText: "APPROVED" }).click();
  await expect(adminPage.locator(".admin-alert.success")).toContainText("approved", { timeout: 20_000 });
  expect(sqlValue(`SELECT RETURN_STATUS FROM RETURNS WHERE RETURN_ID=${returnId}`)).toBe("APPROVED");
  await context.close();
});
