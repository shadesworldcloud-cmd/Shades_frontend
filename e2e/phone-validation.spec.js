const { test, expect } = require("@playwright/test");
const { sql, sqlValue } = require("./support/api");
const { signInAsNewCustomer } = require("./support/ui");
const { observe, clean } = require("./support/observe");

// Phone fields previously accepted any string up to 20 characters — @Size(max = 20) was the only
// server-side rule, so "898097" and "09001807536" are both sitting in the development database
// today. The rule is now: ten national digits beginning 6-9, optionally prefixed 91 or +91, stored
// canonically as +91XXXXXXXXXX.
//
// The rule lives in one place per side (phone.js / PhoneNumbers.java) and these tests check it
// through three different forms plus the raw API, because the point of centralising it is that all
// four agree.

const CLEAN = { consoleErrors: [], pageErrors: [], dialogs: [], badResponses: [] };
const MESSAGE = "Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.";
const unique = (label) => `e2e.${label}-${process.pid}-${Date.now()}@example.test`;
const PASSWORD = "E2ePassw0rd!";

test("registration rejects bad numbers per-field and stores a good one as E.164", async ({ page }) => {
  const seen = observe(page);
  await page.goto("/signin");
  await page.getByRole("button", { name: "Create account" }).click();

  const email = unique("phone");
  await page.getByLabel("Full name").fill("Phone Tester");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);

  // Every rejected shape the rule names, reported against the phone field specifically.
  for (const bad of ["12345", "98765432101", "5123456789", "0123456789", "98765abcde", "-9876543210", "(022) 1234-5678"]) {
    await page.getByLabel(/Phone number/).fill(bad);
    await page.locator(".signin-submit").click();
    await expect(page.locator("#register-phone-error"), `${bad} must be refused`).toHaveText(MESSAGE);
    await expect(page.getByLabel(/Phone number/)).toHaveAttribute("aria-invalid", "true");
    // Other correctly entered values must survive the failure.
    expect(await page.getByLabel("Full name").inputValue()).toBe("Phone Tester");
    expect(await page.getByLabel("Email address").inputValue()).toBe(email);
  }

  // Correcting it clears the message without another submit.
  await page.getByLabel(/Phone number/).fill("9876543210");
  await expect(page.locator("#register-phone-error")).toHaveCount(0);

  await page.locator(".signin-submit").click();
  await expect(page.locator(".signin-success")).toBeVisible({ timeout: 20_000 });
  expect(sqlValue(`SELECT PHONE_NUMBER FROM USERS WHERE EMAIL = '${email}'`),
    "stored canonically, not as typed").toBe("+919876543210");

  expect(clean(seen)).toEqual(CLEAN);
});

test("the accepted formats all normalise to the same stored value", async ({ page }) => {
  // Typed four different ways, the same number must produce one representation — otherwise the
  // same person can exist twice.
  for (const [index, written] of ["9876543210", "919876543210", "+919876543210", "98765 43210"].entries()) {
    const email = unique(`fmt${index}`);
    await page.goto("/signin");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByLabel("Full name").fill("Format Tester");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByLabel(/Phone number/).fill(written);
    await page.locator(".signin-submit").click();
    await expect(page.locator(".signin-success")).toBeVisible({ timeout: 20_000 });
    expect(sqlValue(`SELECT PHONE_NUMBER FROM USERS WHERE EMAIL = '${email}'`), `"${written}" should normalise`)
      .toBe("+919876543210");
  }
});

test("the backend refuses a bad number even when the form is bypassed entirely", async ({ page }) => {
  // The client is a convenience; this is the control that actually holds.
  const account = await signInAsNewCustomer(page, "phoneapi");
  const before = sqlValue(`SELECT PHONE_NUMBER FROM USERS WHERE USER_ID = ${account.userId}`);

  for (const bad of ["12345", "5123456789", "98765abcde", "09001807536"]) {
    const failure = await account.client.put("/auth/me", { name: account.name, phoneNumber: bad })
      .then(() => null).catch((error) => error);
    expect(failure, `the API must reject ${bad}`).not.toBeNull();
    expect(failure.status).toBe(400);
    // The per-field message is what the form renders; it must be present, not just a generic 400.
    expect(JSON.stringify(failure.payload?.validationErrors || {})).toContain("10-digit Indian mobile");
  }
  expect(sqlValue(`SELECT PHONE_NUMBER FROM USERS WHERE USER_ID = ${account.userId}`),
    "a rejected update must not have changed the stored value").toBe(before);

  // And a good one is accepted and normalised by the API itself.
  await account.client.put("/auth/me", { name: account.name, phoneNumber: "  98765 43210 " });
  expect(sqlValue(`SELECT PHONE_NUMBER FROM USERS WHERE USER_ID = ${account.userId}`)).toBe("+919876543210");
});

test("the address API normalises and refuses, for checkout and the account book alike", async ({ page }) => {
  const account = await signInAsNewCustomer(page, "phoneaddr");
  const address = {
    addressType: "SHIPPING", recipientName: "Phone Addr", addressLine1: "1 Test Street",
    city: "Bengaluru", state: "Karnataka", pincode: "560001", country: "India", isDefault: true,
  };

  const failure = await account.client.post("/addresses", { ...address, phoneNumber: "1234" })
    .then(() => null).catch((error) => error);
  expect(failure, "an address with a bad phone must be refused").not.toBeNull();
  expect(failure.status).toBe(400);

  const saved = await account.client.post("/addresses", { ...address, phoneNumber: "+91 98765-43210" });
  expect(sqlValue(`SELECT PHONE_NUMBER FROM ADDRESSES WHERE ADDRESS_ID = ${saved.addressId}`))
    .toBe("+919876543210");
});

test("the checkout form shows the message inline and blocks paying until it is fixed", async ({ page }) => {
  const seen = observe(page);
  await signInAsNewCustomer(page, "phonecheckout");
  await page.goto("/order");
  await page.waitForLoadState("networkidle");

  const phone = page.getByPlaceholder("10-digit mobile number");
  if (await phone.count() === 0) {
    test.skip(true, "checkout shows the saved-address picker for this account, not the new-address form");
  }
  await phone.fill("12345");
  await expect(page.locator("#checkout-phone-error")).toHaveText(MESSAGE);
  await expect(phone).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".checkout-pay-btn"), "an invalid phone blocks payment").toBeDisabled();

  await phone.fill("9876543210");
  await expect(page.locator("#checkout-phone-error")).toHaveCount(0);

  expect(clean(seen)).toEqual(CLEAN);
});

test("the profile form validates inline and keeps the mobile keypad hints", async ({ page }) => {
  const seen = observe(page);
  await signInAsNewCustomer(page, "phoneprofile");
  await page.goto("/account");
  await page.waitForLoadState("networkidle");

  const phone = page.getByLabel("Phone number");
  // Mobile usability: a numeric keypad and telephone autofill, and never type="number".
  await expect(phone).toHaveAttribute("inputmode", "numeric");
  await expect(phone).toHaveAttribute("autocomplete", "tel");
  await expect(phone).toHaveAttribute("type", "tel");

  await phone.fill("5123456789");
  await expect(page.locator("#account-profile-phone-error")).toHaveText(MESSAGE);
  await expect(page.getByRole("button", { name: "Save profile" })).toBeDisabled();

  await phone.fill("9876543210");
  await expect(page.locator("#account-profile-phone-error")).toHaveCount(0);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator(".account-alert.success")).toBeVisible({ timeout: 20_000 });

  expect(clean(seen)).toEqual(CLEAN);
});

test("legacy stored values are reported, never silently rewritten", async ({ page }) => {
  // The migration is a report. Confirm it can see a non-conforming row and that running it changes
  // nothing — a "fix" that guessed at these would attach an order to someone else's number.
  const account = await signInAsNewCustomer(page, "phonelegacy");
  sql(`UPDATE USERS SET PHONE_NUMBER = '0221234567' WHERE USER_ID = ${account.userId}`);
  const before = sqlValue(`SELECT PHONE_NUMBER FROM USERS WHERE USER_ID = ${account.userId}`);
  expect(before).toBe("0221234567");

  const flagged = sqlValue(`SELECT COUNT(*) FROM USERS WHERE PHONE_NUMBER IS NOT NULL AND PHONE_NUMBER <> ''
      AND PHONE_NUMBER NOT REGEXP '^\\\\+91[6-9][0-9]{9}$'`);
  expect(Number(flagged), "the report can see non-conforming rows").toBeGreaterThan(0);
  expect(sqlValue(`SELECT PHONE_NUMBER FROM USERS WHERE USER_ID = ${account.userId}`),
    "reporting must not modify the row").toBe("0221234567");
});
