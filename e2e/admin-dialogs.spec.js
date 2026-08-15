const { test, expect } = require("@playwright/test");
const { createProduct } = require("./support/fixtures");
const { sqlValue } = require("./support/api");
const { signInAsNewAdmin } = require("./support/ui");

// Seven `window.confirm` guards were replaced with the application's ConfirmDialog, via the shared
// useConfirmAction hook. This exercises the admin ones in a real browser and asserts that no native
// dialog appears — recorded, not suppressed, so an escaped window.confirm fails the test.

const watchDialogs = (page) => {
  const seen = [];
  page.on("dialog", async (dialog) => {
    seen.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss().catch(() => {});
  });
  return seen;
};

const openSection = (page, section) =>
  page.locator(".admin-sidebar").getByRole("button", { name: section, exact: true }).click();

test("deactivating a product asks in an application modal and only acts on confirmation", async ({ page }) => {
  const dialogs = watchDialogs(page);
  const product = await createProduct({
    name: `E2E Admin Dialog ${Date.now()}`,
    variants: [{ sku: `AD-${Date.now()}`, variantName: "Ink", color: "Ink", price: 1300, quantityAvailable: 6 }],
  });
  const isActive = () => sqlValue(`SELECT IS_ACTIVE FROM PRODUCTS WHERE PRODUCT_ID=${product.productId}`);
  expect(isActive()).toBe("1");

  await signInAsNewAdmin(page, "admindlg");
  await openSection(page, "Products");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Search products").fill(product.name).catch(() => {});
  const row = page.locator(".product-admin-row", { hasText: product.name }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });

  // "Unpublish" since the draft workflow renamed the action; the behaviour under test is the same.
  const trigger = row.getByRole("button", { name: "Unpublish" });
  await trigger.click();

  // An application modal, not a browser one.
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute("aria-modal", "true");
  await expect(modal).toContainText(product.name);
  expect(dialogs, "no native browser dialog").toEqual([]);
  expect(isActive(), "opening the modal must not change anything").toBe("1");

  // Dismissing leaves it alone.
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  expect(isActive()).toBe("1");

  // Confirming does the work.
  await trigger.click();
  await page.getByRole("dialog").getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });
  await expect.poll(() => isActive(), { timeout: 15_000 }).toBe("0");
  expect(dialogs).toEqual([]);
});

test("no admin section raises a native dialog while being clicked through", async ({ page }) => {
  // A broad sweep rather than a deep one: every section is opened and its primary destructive
  // control is located, proving nothing left behind reaches for window.confirm on render.
  const dialogs = watchDialogs(page);
  await signInAsNewAdmin(page, "adminsweep");
  for (const section of ["Overview", "Offers", "Products", "Orders", "Returns & refunds",
    "Inventory", "Customers", "Review moderation", "Notifications", "Email outbox"]) {
    await openSection(page, section);
    await page.waitForLoadState("networkidle");
  }
  expect(dialogs, "clicking through the admin must raise no browser dialog").toEqual([]);
});
