const { test, expect } = require("@playwright/test");
const { signInAsNewCustomer } = require("./support/ui");
const { observe, clean } = require("./support/observe");

// The "Account security / Password and sessions" section was removed from /account, along with its
// "Email password reset" and "Sign out" controls.
//
// The risk in a removal is not that too little goes — it is that too much does, or that a hollow
// container is left behind. So these tests assert the absence AND that everything around it still
// works: the rest of the page, the global sign-out in the header, and the real password-reset flow
// from its proper home on /signin.

const CLEAN = { consoleErrors: [], pageErrors: [], dialogs: [], badResponses: [] };

test("the Account security section is gone, with no hollow container left behind", async ({ page }) => {
  const seen = observe(page);
  await signInAsNewCustomer(page, "acct");
  await page.goto("/account");
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("heading", { name: "Password and sessions" })).toHaveCount(0);
  await expect(page.getByText("Account security", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Email password reset" })).toHaveCount(0);
  await expect(page.locator(".account-security"), "the container itself is gone, not just hidden").toHaveCount(0);

  // Nothing hidden-but-focusable may survive: a display:none control still reachable by keyboard
  // would be worse than a visible one.
  const strays = await page.evaluate(() => [...document.querySelectorAll("button, a")]
    .filter((el) => /email password reset|password and sessions/i.test(el.textContent || "")).length);
  expect(strays, "no leftover controls from the removed section").toBe(0);

  // And no empty block where it used to be.
  const hollow = await page.evaluate(() => [...document.querySelectorAll(".account-page section, .account-page > div > section")]
    .filter((el) => !el.textContent.trim() && el.getBoundingClientRect().height > 4).length);
  expect(hollow, "no empty section occupying vertical space").toBe(0);

  expect(clean(seen)).toEqual(CLEAN);
});

test("the rest of the account page still works after the removal", async ({ page }) => {
  const seen = observe(page);
  const account = await signInAsNewCustomer(page, "acctrest");
  await page.goto("/account");
  await page.waitForLoadState("networkidle");

  // Profile, addresses and communication preferences all still render and carry real data.
  // The three panels the removed section sat beside, by their actual headings.
  await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saved addresses" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /keep you informed/i })).toBeVisible();
  await expect(page.locator(".account-stats")).toBeVisible();
  expect(await page.locator(".account-panel").count(), "both account panels survive").toBe(2);
  // The email is an input value, not page text, so it has to be read as one.
  await expect(page.locator("input[value='" + account.email + "']")).toHaveCount(1);

  // A hard refresh must still load it for a signed-in customer.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
  await expect(page.locator("input[value='" + account.email + "']")).toHaveCount(1);

  expect(clean(seen)).toEqual(CLEAN);
});

test("the account page holds its layout at desktop, tablet and mobile", async ({ page }) => {
  await signInAsNewCustomer(page, "acctvp");
  for (const [label, width, height] of [["desktop", 1280, 900], ["tablet", 768, 1024], ["mobile", 375, 812]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/account");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".account-page"), `${label} renders`).toBeVisible();
    await expect(page.locator(".account-security"), `${label} has no removed section`).toHaveCount(0);
    const noOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    expect(noOverflow, `${label} must not scroll sideways`).toBe(true);
  }
});

test("the global sign-out still works and protected routing still applies afterwards", async ({ page }) => {
  const seen = observe(page);
  await signInAsNewCustomer(page, "acctout");
  await page.goto("/account");
  await page.waitForLoadState("networkidle");

  // The header control, which is a different component from the one that was removed.
  await page.locator(".nav-account", { hasText: /sign out/i }).click();
  await expect(page.locator(".nav-user")).toHaveCount(0, { timeout: 20_000 });

  // A signed-out visitor must not reach /account.
  await page.goto("/account");
  await page.waitForLoadState("networkidle");
  await expect(page, "protected routing still redirects").toHaveURL(/\/signin/);

  expect(clean(seen)).toEqual(CLEAN);
});

test("password reset still works from its proper place in the auth flow", async ({ page }) => {
  const seen = observe(page);
  const account = await signInAsNewCustomer(page, "acctreset");
  await page.locator(".nav-account", { hasText: /sign out/i }).click();
  await expect(page.locator(".nav-user")).toHaveCount(0, { timeout: 20_000 });

  // Removing the Account-page shortcut must not have disabled the real flow or its API.
  await page.goto("/signin");
  await page.getByRole("button", { name: /forgot password/i }).click();
  await page.getByLabel("Email address").fill(account.email);
  await page.locator("form").getByRole("button", { name: /send|reset/i }).first().click();
  await expect(page.locator(".signin-success, .signin-error")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".signin-success")).toBeVisible({ timeout: 20_000 });

  expect(clean(seen)).toEqual(CLEAN);
});
