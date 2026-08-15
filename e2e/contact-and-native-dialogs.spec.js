const { test, expect } = require("@playwright/test");

// Issue 1: "Contact us" in the "Need more help?" note did nothing on /info/contact, because it was
// a <Link to="/info/contact"> — a link to the page already open. It is now a button that opens the
// Contact Customer Care sheet, built on the app's existing ConfirmDialog.
//
// Issue 2's app-wide half: no native browser dialog may appear in a customer or admin workflow.
// Playwright auto-dismisses dialogs, so a test that did nothing would pass through one silently.
// Every test here records them instead and asserts none fired — the dialogs are NOT suppressed.

const WHATSAPP_URL_PREFIX = "https://wa.me/918233511042?text=";
const SUPPORT_EMAIL = "shadesworldindia11@gmail.com";
const BASE_MESSAGE = "Hello Shades World customer care, I need help with my order.";

/** Records native dialogs and console/network failures without suppressing them. */
const watch = (page) => {
  const seen = { dialogs: [], consoleErrors: [], failedRequests: [] };
  page.on("dialog", async (dialog) => {
    seen.dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    // Accept only so the run can continue and report; the assertion below still fails the test.
    await dialog.dismiss().catch(() => {});
  });
  page.on("console", (message) => {
    // A signed-out visitor's GET /auth/me is a 401 by design — that is how the app asks "is anyone
    // signed in". Chrome logs every 401 as a console error, so excluding it is what makes this
    // assertion mean "no unexpected errors" rather than "no errors at all". Nothing else is
    // excluded.
    const text = message.text();
    const guestAuthProbe = /status of 401/.test(text);
    if (message.type() === "error" && !guestAuthProbe) seen.consoleErrors.push(text.slice(0, 200));
  });
  page.on("requestfailed", (request) => {
    // Ignore the deliberately unresolvable fixture image hosts used by other specs.
    if (!/images\.test/.test(request.url())) seen.failedRequests.push(request.url().slice(0, 160));
  });
  return seen;
};

const openContact = async (page) => {
  await page.goto("/info/contact");
  await page.waitForLoadState("networkidle");
  const trigger = page.getByRole("button", { name: "Contact us" });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  return trigger;
};

test("the contact action opens a real dialog with the correct email and WhatsApp targets", async ({ page }) => {
  const seen = watch(page);
  await openContact(page);

  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.getByRole("heading", { name: "Contact Customer Care" })).toBeVisible();

  // Email address shown verbatim and used as a mailto target.
  await expect(dialog).toContainText(SUPPORT_EMAIL);
  const mailto = dialog.getByRole("link", { name: /email customer care/i });
  await expect(mailto).toHaveAttribute("href", new RegExp(`^mailto:${SUPPORT_EMAIL.replace(".", "\\.")}\\?`));

  // The number must be identified as WhatsApp only, never as phone support.
  await expect(dialog).toContainText("+91 8233511042");
  await expect(dialog).toContainText(/whatsapp only/i);
  await expect(dialog).toContainText(/does not accept phone calls/i);

  const whatsapp = dialog.getByRole("link", { name: /message on whatsapp/i });
  const href = await whatsapp.getAttribute("href");
  expect(href.startsWith(WHATSAPP_URL_PREFIX), `wa.me target, got ${href}`).toBe(true);
  // Correctly encoded, and decoding returns the intended sentence.
  expect(decodeURIComponent(href.slice(WHATSAPP_URL_PREFIX.length))).toBe(BASE_MESSAGE);
  expect(href).not.toContain(" ");
  // Opened safely: a real link, so no blank window is left behind and a popup blocker cannot eat it.
  await expect(whatsapp).toHaveAttribute("target", "_blank");
  await expect(whatsapp).toHaveAttribute("rel", /noopener/);
  await expect(whatsapp).toHaveAttribute("rel", /noreferrer/);

  expect(seen.dialogs, "no native browser dialog may appear").toEqual([]);
  expect(seen.consoleErrors, "no console errors").toEqual([]);
  expect(seen.failedRequests, "no failed requests").toEqual([]);
});

test("a typed order number is carried into both targets, encoded", async ({ page }) => {
  const seen = watch(page);
  await openContact(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/order number/i).fill("1042");

  const expected = `${BASE_MESSAGE} My order number is 1042.`;
  const href = await dialog.getByRole("link", { name: /message on whatsapp/i }).getAttribute("href");
  expect(decodeURIComponent(href.slice(WHATSAPP_URL_PREFIX.length))).toBe(expected);
  const mailtoHref = await dialog.getByRole("link", { name: /email customer care/i }).getAttribute("href");
  expect(decodeURIComponent(mailtoHref)).toContain(expected);
  expect(seen.dialogs).toEqual([]);
});

test("the dialog closes by button, Escape and backdrop, and restores focus each time", async ({ page }) => {
  const seen = watch(page);
  const trigger = await openContact(page);
  const dialog = page.getByRole("dialog");

  // 1. Close button.
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger, "focus returns to the trigger").toBeFocused();

  // 2. Escape.
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  // 3. Backdrop, which is how every other dialog in this app dismisses.
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.locator(".confirm-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  expect(seen.dialogs).toEqual([]);
});

test("the whole flow works from the keyboard alone and traps focus", async ({ page }) => {
  const seen = watch(page);
  await page.goto("/info/contact");
  await page.waitForLoadState("networkidle");

  const trigger = page.getByRole("button", { name: "Contact us" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();

  // Focus lands inside the dialog, and Tab cannot escape it.
  for (let step = 0; step < 8; step += 1) {
    const inside = await page.evaluate(() => Boolean(document.querySelector(".confirm-dialog")?.contains(document.activeElement)));
    expect(inside, `focus stayed inside the dialog at step ${step}`).toBe(true);
    await page.keyboard.press("Tab");
  }

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(seen.dialogs).toEqual([]);
});

for (const [label, width, height] of [["desktop", 1280, 900], ["tablet", 768, 1024], ["mobile", 375, 812]]) {
  test(`the contact flow works at ${label} width and survives a refresh`, async ({ page }) => {
    const seen = watch(page);
    await page.setViewportSize({ width, height });
    await openContact(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("link", { name: /message on whatsapp/i })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
    // Nothing may spill sideways at any width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    expect(overflow, `no horizontal overflow at ${width}px`).toBe(true);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await openContact(page);
    await expect(page.getByRole("dialog")).toBeVisible();

    expect(seen.dialogs).toEqual([]);
    expect(seen.consoleErrors).toEqual([]);
  });
}
