const { test, expect } = require("@playwright/test");
const { createCustomer, promoteToAdmin } = require("./support/api");
const { createProduct } = require("./support/fixtures");
const { WIDTHS, overflowReport, overflows } = require("./support/layout");
const { submitSignIn } = require("./support/ui");

// The admin shell was exempt from responsive-overflow.spec.js for a structural reason, not an
// oversight: `.admin-main` carried `overflow: hidden`, which held the 250px-sidebar grid together
// by clipping every overflow out of existence. That made a document-level scrollWidth check
// unfalsifiable here — it could not fail, including when the layout was genuinely broken — and it
// made any admin content too wide for the viewport unreachable rather than scrollable.
//
// `.admin-main` is now `min-width: 0`, which holds the grid track without hiding anything. This
// spec is what makes that trade honest: with the clipping gone, overflow is now observable, so it
// has to be observed.
//
// The admin is one route (/admin) with a section switcher, not ten routes, so the sweep clicks the
// sidebar rather than navigating.
const SECTIONS = [
  "Overview", "Offers", "Products", "Orders", "Returns & refunds",
  "Inventory", "Customers", "Review moderation", "Notifications", "Email outbox",
];

let adminAccount;

test.beforeAll(async () => {
  // A long unbroken SKU and an unbroken colourway name: a grid item's automatic minimum size is
  // its min-content width, so a single string like this used to widen a whole column and push the
  // row — and with it the document — sideways. This is the data shape that has to be present for
  // the checks below to mean anything.
  await createProduct({
    name: `E2E Admin Overflow Product With A Very Long Name ${Date.now()}`,
    variants: [{
      sku: `ADMIN-OVERFLOW-EXTREMELY-LONG-SKU-${Date.now()}`,
      variantName: "Exceptionally Long Colourway Name",
      color: "Exceptionally Long Colourway Name",
      price: 1400, quantityAvailable: 3,
    }],
  });

  // One account signed in twice, rather than signInAsNewAdmin per test. Registration is the
  // scarcest resource in this suite — 10 per IP per minute against 29 accounts — and login is
  // capped at twice that, so two sign-ins are strictly cheaper than two registrations.
  adminAccount = await createCustomer("adminresp");
  promoteToAdmin(adminAccount.userId);
});

/** Scoped to the sidebar: section names also appear on buttons inside the sections themselves. */
const openSection = (page, section) =>
  page.locator(".admin-sidebar").getByRole("button", { name: section, exact: true }).click();

// A laptop width on top of the shared phone/tablet set. The shared widths are all below 820px,
// where the shell is a single column and the sidebar is stacked — so none of them exercise the
// two-column layout that `.admin-main { overflow: hidden }` was actually written for. That is the
// layout whose clipping was just removed, so it is the one most in need of being measured.
const ADMIN_WIDTHS = [...WIDTHS, { name: "laptop", width: 1280, height: 800 }];

test("no admin section scrolls horizontally at narrow widths", async ({ page }) => {
  await submitSignIn(page, adminAccount, { admin: true });
  const failures = [];

  for (const size of ADMIN_WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const section of SECTIONS) {
      // Below 820px the sidebar itself becomes a horizontal scroller, so the target may need
      // scrolling into view first — click() does that on its own.
      await openSection(page, section);
      // Each section fetches its own data and the widths under test are data-driven, so measuring
      // before it lands would measure an empty table.
      await page.waitForLoadState("networkidle");
      const report = await overflowReport(page);
      if (overflows(report)) {
        failures.push(`${section} at ${size.width}px: scrollWidth ${report.scrollWidth} > ${report.limit}; `
          + `offenders ${JSON.stringify(report.offenders)}`);
      }
    }
  }

  expect(failures, "horizontal overflow in the admin shell").toEqual([]);
});

test("admin content stays reachable instead of being clipped away", async ({ page }) => {
  // The complement to the sweep above, and the reason `overflow: hidden` was the wrong fix rather
  // than merely an untestable one: a page with no horizontal scrollbar is not automatically a good
  // one, because clipping produces exactly the same measurement. Wide admin content is allowed —
  // it just has to live in something that scrolls, so the admin can reach it. The email outbox
  // table is the case in point, deliberately 1050px wide inside its own scroll container.
  await submitSignIn(page, adminAccount, { admin: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await openSection(page, "Email outbox");
  await page.waitForLoadState("networkidle");

  const wrap = page.locator(".outbox-table-wrap");
  await expect(wrap).toBeVisible();
  const table = await wrap.evaluate((node) => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
    overflowX: getComputedStyle(node).overflowX,
  }));
  expect(table.overflowX, "the wide table must sit in a scroller, not be clipped").toMatch(/auto|scroll/);
  expect(table.scrollWidth, "the table is wider than the phone, which is the whole point")
    .toBeGreaterThan(table.clientWidth);

  // And the page around that scroller still must not push the document sideways.
  expect(overflows(await overflowReport(page))).toBe(false);
});
