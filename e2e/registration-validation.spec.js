const { test, expect } = require("@playwright/test");
const { sql, sqlValue } = require("./support/api");

// The reported symptom was that creating an account showed only "One or more fields have validation
// errors". The backend was never at fault: GlobalExceptionHandler puts one message per field in
// `validationErrors` and sets `message` to that generic sentence deliberately. api.js built its
// Error from `message` alone and discarded the map, so the form had nothing field-specific to show.
//
// These tests assert the field-level messages, the focus behaviour, and that exactly one account is
// created — plus that nothing sensitive leaks into the console, the URL or storage.

const unique = (label) => `e2e.${label}-${process.pid}-${Date.now()}@example.test`;
const VALID_PASSWORD = "E2ePassw0rd!";

const { observe, clean } = require("./support/observe");
const { submitRegistration } = require("./support/ui");
const watch = observe;

const openRegister = async (page) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByLabel("Full name")).toBeVisible();
};

const fillRegistration = async (page, { name, email, password, confirmPassword, phone } = {}) => {
  if (name !== undefined) await page.getByLabel("Full name").fill(name);
  if (email !== undefined) await page.getByLabel("Email address").fill(email);
  if (password !== undefined) await page.getByLabel("Password", { exact: true }).fill(password);
  if (confirmPassword !== undefined) await page.getByLabel("Confirm password").fill(confirmPassword);
  if (phone !== undefined) await page.getByLabel(/Phone number/).fill(phone);
};

// Two submit paths, and the difference matters. `submit` is a bare click, for the cases where
// validateRegistration rejects the form in the browser and nothing is sent — there is no response to
// wait for. Anything that does reach POST /auth/register goes through submitRegistration, which
// waits out AuthRateLimitFilter; this spec creates several accounts and is the one place in the suite
// that registers through the form rather than the API, so it is the one place with no other backoff.
const submit = (page) => page.locator(".signin-submit").click();
const errorFor = (page, id) => page.locator(`#${id}-error`);

test("an empty form names every required field instead of one generic sentence", async ({ page }) => {
  const seen = watch(page);
  await openRegister(page);
  await submit(page);

  await expect(errorFor(page, "register-name")).toHaveText("Name is required");
  await expect(errorFor(page, "signin-email")).toHaveText("Email is required");
  await expect(errorFor(page, "signin-password")).toHaveText("Password is required");
  await expect(errorFor(page, "register-confirm-password")).toHaveText("Confirm your password");

  // The generic sentence may appear as a summary, but never as the only feedback.
  await expect(page.locator(".signin-error")).toBeVisible();
  await expect(page.getByLabel("Full name"), "focus moves to the first invalid field").toBeFocused();
  // Each message is tied to its input for assistive technology.
  await expect(page.getByLabel("Full name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Full name")).toHaveAttribute("aria-describedby", "register-name-error");

  expect(seen.dialogs).toEqual([]);
  expect(clean(seen), "the page must be clean").toEqual({ consoleErrors: [], pageErrors: [], dialogs: [], badResponses: [] });
});

test("each invalid field is reported on its own with the server's wording", async ({ page }) => {
  await openRegister(page);

  // Invalid email shape.
  await fillRegistration(page, { name: "Ada Lovelace", email: "not-an-email", password: VALID_PASSWORD, confirmPassword: VALID_PASSWORD });
  await submit(page);
  await expect(errorFor(page, "signin-email")).toHaveText("Invalid email format");
  await expect(page.getByLabel("Email address")).toBeFocused();
  await expect(errorFor(page, "register-name")).toHaveCount(0);

  // Weak password — same sentence the backend's @Size carries.
  await fillRegistration(page, { email: unique("weak"), password: "short", confirmPassword: "short" });
  await submit(page);
  await expect(errorFor(page, "signin-password")).toHaveText("Password must be between 8 and 100 characters");

  // Mismatched confirmation identifies the mismatch specifically.
  await fillRegistration(page, { password: VALID_PASSWORD, confirmPassword: "Different1!" });
  await submit(page);
  await expect(errorFor(page, "register-confirm-password")).toHaveText(/does not match/i);
  await expect(page.getByLabel("Confirm password")).toBeFocused();

  // Over-long phone, which is the only phone rule the backend actually has (@Size(max = 20)).
  await fillRegistration(page, { confirmPassword: VALID_PASSWORD, phone: "1".repeat(21) });
  await submit(page);
  // maxLength on the input stops 21 characters ever arriving, so this proves the cap holds at 20
  // rather than that the message fires — the message is unreachable through the UI by design.
  expect(await page.getByLabel(/Phone number/).inputValue()).toHaveLength(20);
});

test("correcting a field clears its message and leaves the others alone", async ({ page }) => {
  await openRegister(page);
  await submit(page);
  await expect(errorFor(page, "register-name")).toBeVisible();
  await expect(errorFor(page, "signin-email")).toBeVisible();

  await page.getByLabel("Full name").fill("Ada Lovelace");
  await expect(errorFor(page, "register-name"), "the corrected field clears immediately").toHaveCount(0);
  await expect(errorFor(page, "signin-email"), "other fields keep their messages").toBeVisible();
  await expect(page.getByLabel("Full name")).not.toHaveAttribute("aria-invalid", "true");
});

test("a valid submission creates exactly one CUSTOMER account and does not clear the form on failure", async ({ page }) => {
  const seen = watch(page);
  const email = unique("reg");
  await openRegister(page);
  await fillRegistration(page, {
    name: "  Ada Lovelace-O'Brien  ", email: `  ${email}  `, password: VALID_PASSWORD,
    confirmPassword: VALID_PASSWORD, phone: "9876543210",
  });
  await submitRegistration(page);

  // The product flow is: register, then land back on sign-in with a verification notice.
  await expect(page.locator(".signin-success")).toBeVisible({ timeout: 20_000 });

  // Exactly one row, with whitespace normalised and the name's legitimate characters preserved.
  expect(Number(sqlValue(`SELECT COUNT(*) FROM USERS WHERE EMAIL = '${email}'`)), "exactly one account").toBe(1);
  expect(sqlValue(`SELECT NAME FROM USERS WHERE EMAIL = '${email}'`)).toBe("Ada Lovelace-O'Brien");
  // Leading/trailing spaces must not create a second, distinct account.
  expect(Number(sqlValue(`SELECT COUNT(*) FROM USERS WHERE TRIM(EMAIL) <> EMAIL`)), "no untrimmed emails stored").toBe(0);
  // A new customer must never be an administrator.
  const roles = sqlValue(`SELECT GROUP_CONCAT(r.ROLE_NAME) FROM USERS u
      JOIN USER_ROLES ur ON ur.USER_ID = u.USER_ID JOIN ROLES r ON r.ROLE_ID = ur.ROLE_ID
      WHERE u.EMAIL = '${email}'`);
  expect(roles).toBe("CUSTOMER");

  // The password must not reach the URL, storage or the console.
  expect(page.url()).not.toContain(VALID_PASSWORD);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain(VALID_PASSWORD);
  expect(seen.consoleErrors.join(" ")).not.toContain(VALID_PASSWORD);
  expect(seen.dialogs).toEqual([]);

});

test("an already registered email is refused clearly, and the typed values survive", async ({ page }) => {
  const email = unique("dupe");
  await openRegister(page);
  await fillRegistration(page, { name: "First Owner", email, password: VALID_PASSWORD, confirmPassword: VALID_PASSWORD });
  await submitRegistration(page);
  await expect(page.locator(".signin-success")).toBeVisible({ timeout: 20_000 });

  await openRegister(page);
  await fillRegistration(page, { name: "Second Owner", email, password: VALID_PASSWORD, confirmPassword: VALID_PASSWORD });
  await submitRegistration(page);

  await expect(page.locator(".signin-error")).toContainText(/already registered/i, { timeout: 20_000 });
  // No second row, and nothing about the existing account is disclosed beyond "it exists".
  expect(Number(sqlValue(`SELECT COUNT(*) FROM USERS WHERE EMAIL = '${email}'`))).toBe(1);
  await expect(page.locator(".signin-error")).not.toContainText(/First Owner/);
  // Correctly entered values must not be wiped by a failure.
  expect(await page.getByLabel("Full name").inputValue()).toBe("Second Owner");
  expect(await page.getByLabel("Email address").inputValue()).toBe(email);
});

test("rapid double submission creates only one account", async ({ page }) => {
  const email = unique("double");
  await openRegister(page);
  await fillRegistration(page, { name: "Double Click", email, password: VALID_PASSWORD, confirmPassword: VALID_PASSWORD });

  // The three clicks are the test, so they are handed to submitRegistration as the submit action
  // rather than replaced by it: a rate limit retries the whole rapid-click sequence on the still
  // filled-in form, which is the same scenario again, not a weaker one.
  const button = page.locator(".signin-submit");
  await submitRegistration(page, {
    submit: async () => {
      await button.click();
      await button.click({ force: true }).catch(() => {});
      await button.click({ force: true }).catch(() => {});
    },
  });
  await expect(page.locator(".signin-success")).toBeVisible({ timeout: 20_000 });

  expect(Number(sqlValue(`SELECT COUNT(*) FROM USERS WHERE EMAIL = '${email}'`)),
    "three clicks must still create one account").toBe(1);
});

test("refresh and Back/Forward after registering do not resubmit the form", async ({ page }) => {
  const email = unique("history");
  await openRegister(page);
  await fillRegistration(page, { name: "History Test", email, password: VALID_PASSWORD, confirmPassword: VALID_PASSWORD });
  await submitRegistration(page);
  await expect(page.locator(".signin-success")).toBeVisible({ timeout: 20_000 });

  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.goBack().catch(() => {});
  await page.goForward().catch(() => {});
  await page.waitForLoadState("networkidle");

  expect(Number(sqlValue(`SELECT COUNT(*) FROM USERS WHERE EMAIL = '${email}'`)),
    "a refresh or history navigation must not create a second account").toBe(1);
});

test("a server failure and a malformed response both produce a useful, non-sensitive message", async ({ page }) => {
  const seen = watch(page);
  await openRegister(page);

  // 1. A 500 with a normal error body.
  await page.route("**/auth/register", (route) => route.fulfill({
    status: 500, contentType: "application/json", body: JSON.stringify({ message: "Registration is unavailable" }),
  }));
  await fillRegistration(page, { name: "Server Error", email: unique("err"), password: VALID_PASSWORD, confirmPassword: VALID_PASSWORD });
  await submit(page);
  await expect(page.locator(".signin-error")).toContainText("Registration is unavailable");

  // 2. A body that is not JSON at all — parseResponse must not explode on it.
  await page.route("**/auth/register", (route) => route.fulfill({
    status: 500, contentType: "text/html", body: "<html>gateway blew up</html>",
  }));
  await submit(page);
  await expect(page.locator(".signin-error")).toBeVisible();
  await expect(page.locator(".signin-error"), "no HTML or stack trace may reach the customer")
    .not.toContainText(/<html>|Exception|\.java:/);

  // 3. The network is simply gone.
  await page.route("**/auth/register", (route) => route.abort("failed"));
  await submit(page);
  await expect(page.locator(".signin-error")).toBeVisible();

  await page.unroute("**/auth/register");
  expect(seen.dialogs).toEqual([]);
});

test("registration works at mobile and tablet widths", async ({ page }) => {
  for (const [label, width, height] of [["mobile", 375, 812], ["tablet", 768, 1024]]) {
    await page.setViewportSize({ width, height });
    await openRegister(page);
    await submit(page);
    await expect(errorFor(page, "register-name"), `${label} shows field errors`).toBeVisible();
    const noOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    expect(noOverflow, `${label} must not scroll sideways`).toBe(true);
  }
  expect(sql("SELECT 1")).toBe("1");
});
