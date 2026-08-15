const { test, expect } = require("@playwright/test");
const { createProduct, orderStatus } = require("./support/fixtures");
const { sqlValue } = require("./support/api");
const { signInAsNewCustomer } = require("./support/ui");
const { addToBag, checkout } = require("./support/shop");

// Order cancellation already used the application's ConfirmDialog rather than window.confirm — that
// was replaced in earlier work. What was missing was proof: nothing asserted that no native dialog
// appears, that exactly one cancellation request is sent, that a failure keeps the modal open, or
// that an ineligible order is refused. This spec is that proof.
//
// Native dialogs are recorded, never suppressed. Playwright auto-dismisses them, so a test that
// ignored them would sail straight through one.

const watchDialogs = (page) => {
  const seen = [];
  page.on("dialog", async (dialog) => {
    seen.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss().catch(() => {});
  });
  return seen;
};

/**
 * Counts calls to the cancellation endpoint, and only that endpoint: POST /orders/{id}/cancel.
 * A looser "any non-GET under /orders" filter also caught the checkout traffic that creates the
 * order in the first place, which made "opening the dialog sent no request" fail against three
 * calls that had nothing to do with cancelling.
 */
const watchCancelRequests = (page) => {
  const calls = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/orders\/\d+\/cancel$/.test(request.url())) {
      calls.push(`${request.method()} ${request.url().replace(/^.*\/api/, "")}`);
    }
  });
  return calls;
};

let product;

test.beforeAll(async () => {
  product = await createProduct({
    name: `E2E Cancel Dialog ${Date.now()}`,
    variants: [{ sku: `CD-${Date.now()}`, variantName: "Slate", color: "Slate", price: 1200, quantityAvailable: 40 }],
  });
});

/** Buys one unit and opens the cancel dialog for the resulting order. */
const openCancelDialog = async (page, account) => {
  await addToBag(page, { productId: product.productId, quantity: 1, expectedBadge: 1 });
  const orderId = await checkout(page, { account });
  await page.goto("/my-orders");
  await page.waitForLoadState("networkidle");
  const trigger = page.getByRole("button", { name: /cancel order/i }).first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  return { orderId, trigger };
};

test("opening the dialog shows an application modal, not a browser dialog, and cancels nothing", async ({ page }) => {
  const dialogs = watchDialogs(page);
  const calls = watchCancelRequests(page);
  const account = await signInAsNewCustomer(page, "canceldlg");
  const { orderId } = await openCancelDialog(page, account);

  const modal = page.getByRole("dialog");
  await expect(modal).toHaveAttribute("aria-modal", "true");
  await expect(modal, "the order number belongs in the modal").toContainText(String(orderId));
  await expect(modal, "cancellation must be described as not reversible").toContainText(/cannot be undone|not be reversed|permanent/i);

  expect(dialogs, "no native browser dialog may appear").toEqual([]);
  expect(calls, "merely opening the dialog must not call the API").toEqual([]);
  expect(orderStatus(orderId), "the order is untouched before confirmation").not.toBe("CANCELLED");
});

test("Keep Order and Escape both leave the order alone and send no request", async ({ page }) => {
  const dialogs = watchDialogs(page);
  const calls = watchCancelRequests(page);
  const account = await signInAsNewCustomer(page, "cancelkeep");
  const { orderId, trigger } = await openCancelDialog(page, account);

  // 1. The non-destructive button.
  await page.getByRole("dialog").getByRole("button", { name: /keep|close|go back/i }).first().click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger, "focus returns to the Cancel Order button").toBeFocused();
  expect(orderStatus(orderId)).not.toBe("CANCELLED");

  // 2. Escape.
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();

  expect(calls, "no cancellation request may be sent from either dismissal").toEqual([]);
  expect(dialogs).toEqual([]);
  expect(orderStatus(orderId)).not.toBe("CANCELLED");
});

test("confirming sends exactly one request and the status survives a hard refresh", async ({ page }) => {
  const dialogs = watchDialogs(page);
  const calls = watchCancelRequests(page);
  const account = await signInAsNewCustomer(page, "cancelone");
  const { orderId } = await openCancelDialog(page, account);

  const confirm = page.getByRole("dialog").getByRole("button", { name: /cancel the order/i });
  // Two clicks in quick succession: the dialog's busy guard is what must collapse them into one
  // request. window.confirm blocked the thread and made this impossible by construction; a React
  // modal does not, so the guard has to be deliberate.
  await confirm.click();
  await confirm.click({ force: true }).catch(() => {});
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });

  expect(calls.length, `exactly one cancellation request, got ${JSON.stringify(calls)}`).toBe(1);
  expect(orderStatus(orderId)).toBe("CANCELLED");

  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(orderStatus(orderId), "the cancelled status persists across a hard refresh").toBe("CANCELLED");
  // Re-running history must not fire a second cancellation.
  await page.goBack().catch(() => {});
  await page.goForward().catch(() => {});
  await page.waitForLoadState("networkidle");
  expect(calls.length, "Back/Forward must not repeat the request").toBe(1);
  expect(dialogs).toEqual([]);
});

test("a failing cancellation keeps the modal open, shows the error and leaves the order intact", async ({ page }) => {
  const dialogs = watchDialogs(page);
  const account = await signInAsNewCustomer(page, "cancelfail");
  const { orderId } = await openCancelDialog(page, account);

  // Fail the cancellation at the network layer — the real request is made and really fails, rather
  // than the UI being tricked into a fake error path.
  await page.route(/\/orders\/\d+/, (route) => {
    if (route.request().method() === "GET") return route.continue();
    return route.fulfill({ status: 500, contentType: "application/json",
      body: JSON.stringify({ message: "Cancellation service unavailable" }) });
  });

  await page.getByRole("dialog").getByRole("button", { name: /cancel the order/i }).click();
  const modal = page.getByRole("dialog");
  await expect(modal, "the modal stays open so the shopper knows it did not happen").toBeVisible();
  await expect(modal).toContainText(/unavailable|went wrong|try again/i);
  expect(orderStatus(orderId), "a failed cancellation must not change the order").not.toBe("CANCELLED");
  expect(dialogs).toEqual([]);

  await page.unroute(/\/orders\/\d+/);
});

test("an order that is no longer eligible is refused by the server", async ({ page }) => {
  const account = await signInAsNewCustomer(page, "cancelinelig");
  await addToBag(page, { productId: product.productId, quantity: 1, expectedBadge: 1 });
  const orderId = await checkout(page, { account });

  // Drive it past the cancellable window behind the UI's back — this is the stale-frontend case.
  const { sql } = require("./support/api");
  sql(`UPDATE ORDERS SET ORDER_STATUS='SHIPPED' WHERE ORDER_ID=${orderId}`);

  const failure = await account.client.post(`/orders/${orderId}/cancel`).then(() => null).catch((error) => error);
  expect(failure, "the backend must revalidate eligibility, not trust the client").not.toBeNull();
  expect(failure.status).toBeGreaterThanOrEqual(400);
  expect(String(failure.message)).toMatch(/cannot be cancelled/i);
  expect(orderStatus(orderId)).toBe("SHIPPED");
});

test("the dialog is usable by keyboard at desktop, tablet and mobile widths", async ({ page }) => {
  const dialogs = watchDialogs(page);
  const account = await signInAsNewCustomer(page, "cancelvp");
  const { trigger } = await openCancelDialog(page, account);
  await page.keyboard.press("Escape");

  for (const [label, width, height] of [["desktop", 1280, 900], ["tablet", 768, 1024], ["mobile", 375, 812]]) {
    await page.setViewportSize({ width, height });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog"), `${label} opens from the keyboard`).toBeVisible();

    // Focus must be inside and must not escape.
    for (let step = 0; step < 5; step += 1) {
      const inside = await page.evaluate(() =>
        Boolean(document.querySelector(".confirm-dialog")?.contains(document.activeElement)));
      expect(inside, `${label}: focus stayed trapped at step ${step}`).toBe(true);
      await page.keyboard.press("Tab");
    }
    const noOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    expect(noOverflow, `${label}: the dialog must not push the page sideways`).toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(trigger, `${label}: focus returns to the trigger`).toBeFocused();
  }
  expect(dialogs).toEqual([]);
});
