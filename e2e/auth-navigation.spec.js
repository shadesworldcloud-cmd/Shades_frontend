const { test, expect } = require("@playwright/test");
const { createCustomer, promoteToAdmin } = require("./support/api");
const { signInAsNewAdmin, signInAsNewCustomer } = require("./support/ui");

// Issue 2: sign-out must be idempotent and browser navigation must never produce an uncaught error.
// Every test watches the console and page errors for the whole run and asserts they stayed clean.

/** Collects console errors, page errors and failed requests for the life of a page. */
const watch = (page) => {
  const problems = { console: [], pageErrors: [], failedRequests: [] };
  page.on("console", (message) => { if (message.type() === "error") problems.console.push(message.text()); });
  page.on("pageerror", (error) => problems.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    // Navigation aborts are a normal consequence of redirecting mid-flight, not a defect.
    const failure = request.failure()?.errorText || "";
    if (/ERR_ABORTED|net::ERR_ABORTED/.test(failure)) return;
    // images.test is a deliberately unresolvable host used by variant-default-selection.spec.js to
    // bind photos to variants (a variant image is identified purely by a /variants/<id>/ segment in
    // its URL). Those fixture products live in the shared catalogue, so any spec that browses the
    // storefront will try to load them and get ERR_NAME_NOT_RESOLVED. That is test data failing to
    // resolve, not the application failing a request — every real request is still asserted.
    if (/images\.test/.test(request.url())) return;
    problems.failedRequests.push(`${request.url()} ${failure}`);
  });
  return problems;
};
const expectClean = (problems) => {
  expect(problems.pageErrors, "no uncaught page errors").toEqual([]);
  expect(problems.console.filter((line) => /Something went wrong/i.test(line)), "no parseResponse failure").toEqual([]);
  expect(problems.failedRequests, "no failed requests").toEqual([]);
};

const signInAsAdmin = (page) => signInAsNewAdmin(page, "nav-admin");

test("an admin can sign in, navigate protected pages, use Back and Forward, and refresh cleanly", async ({ page }) => {
  const problems = watch(page);
  await signInAsAdmin(page);

  for (const section of ["Products", "Orders", "Returns & refunds", "Customers"]) {
    await page.locator(".admin-sidebar nav button", { hasText: section }).click();
    await expect(page.locator(".admin-shell, .returns-admin, .ops-admin, .products-toolbar").first()).toBeVisible();
  }

  await page.goBack();
  await page.goForward();
  await page.reload();
  // Session survives the refresh rather than bouncing to sign-in.
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.locator(".admin-sidebar")).toBeVisible({ timeout: 20_000 });
  expectClean(problems);
});

test("pressing Back out of the admin area signs the admin out without an error screen", async ({ page }) => {
  const problems = watch(page);
  // Start on the storefront so there is a real history entry to go Back to. This is the reported
  // scenario: "navigating back after signing in as an administrator".
  await page.goto("/");
  await page.locator(".nav-account", { hasText: /sign in/i }).click();
  await expect(page).toHaveURL(/\/signin/);

  await signInAsNewAdmin(page, "nav-back-admin");

  // AdminExitGuard signs an admin out when they leave /admin — including via Back. That is
  // deliberate; what must not happen is an unhandled rejection from the logout call.
  await page.goBack();
  await expect(page).toHaveURL(/\/signin/, { timeout: 20_000 });
  await expect(page.locator(".signin-submit")).toBeVisible();
  expectClean(problems);

  // Back again must not resurrect the admin screen or its data.
  await page.goBack();
  await expect(page.locator(".admin-sidebar")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Review moderation");
  // Case matters: the DOM says "Store administration" and the uppercase look is CSS only, so the
  // previous all-caps form could never have matched and the assertion could never have failed.
  await expect(page.locator("body")).not.toContainText("Store administration");
  expectClean(problems);
});

test("signing out with an already-dead session is safe and silent", async ({ page }) => {
  const problems = watch(page);
  await signInAsNewCustomer(page, "deadsession");

  // Kill the session server-side, so the app still believes it is signed in. This is what an
  // expired session looks like to the browser.
  const killed = await page.evaluate(async () => {
    const api = "http://localhost:8081/api";
    const token = (await (await fetch(`${api}/auth/csrf`, { credentials: "include" })).json()).token;
    const response = await fetch(`${api}/auth/logout`, {
      method: "POST", credentials: "include", headers: { "X-XSRF-TOKEN": token },
    });
    return response.status;
  });
  expect(killed).toBe(200);

  await page.locator(".nav-account", { hasText: /sign out/i }).click();
  await expect(page.locator(".nav-user")).toHaveCount(0, { timeout: 20_000 });
  expectClean(problems);
});

test("a logout rejected by the server still signs the customer out locally", async ({ page }) => {
  const problems = watch(page);
  await signInAsNewCustomer(page, "rejectedlogout");

  // Force every logout attempt to fail the way a CSRF mismatch does: 401 with an empty body.
  // That is the exact response that used to surface as "Something went wrong. Please try again."
  await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 401, body: "" }));

  await page.locator(".nav-account", { hasText: /sign out/i }).click();
  await expect(page.locator(".nav-user")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".nav-account", { hasText: /sign in/i })).toBeVisible();
  // The whole point of the fix: no uncaught error, no "Something went wrong" screen.
  expect(problems.pageErrors).toEqual([]);
  expect(problems.console.filter((line) => /Something went wrong/i.test(line))).toEqual([]);

  // The server never processed that logout, so its session cookie is genuinely still valid and a
  // reload legitimately restores it — the cookie is HttpOnly, so no client-side clearing could
  // have prevented that. What matters is that retrying now works and is not poisoned by the
  // earlier failure.
  await page.unroute("**/api/auth/logout");
  await page.reload();
  await expect(page.locator(".nav-user")).toBeVisible({ timeout: 20_000 });
  await page.locator(".nav-account", { hasText: /sign out/i }).click();
  await expect(page.locator(".nav-user")).toHaveCount(0, { timeout: 20_000 });
  await page.reload();
  await expect(page.locator(".nav-user")).toHaveCount(0, { timeout: 20_000 });
  expect(problems.pageErrors).toEqual([]);
});

test("a customer can sign in, browse protected pages, use Back and Forward, refresh, then sign out", async ({ page }) => {
  const problems = watch(page);
  await signInAsNewCustomer(page, "navcust");

  for (const path of ["/account", "/my-orders", "/wishlist"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(path));
  }
  await page.goBack();
  await page.goBack();
  await page.goForward();
  await page.reload();
  // Still authenticated after a hard refresh of a protected page.
  await expect(page.locator(".nav-user")).toBeVisible({ timeout: 20_000 });

  await page.locator(".nav-account", { hasText: /sign out/i }).click();
  await expect(page.locator(".nav-user")).toHaveCount(0, { timeout: 20_000 });
  expectClean(problems);

  // Back after sign-out must not show protected content.
  await page.goBack();
  await expect(page.locator(".nav-user")).toHaveCount(0);
  expectClean(problems);
});
