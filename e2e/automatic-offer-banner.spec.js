const { test, expect } = require("@playwright/test");
const { admin, clearAutomaticOffers, withAutomaticOffer } = require("./support/fixtures");
const { observe, clean } = require("./support/observe");
const { overflowReport } = require("./support/layout");

// The homepage banner strip.
//
// The requirement that costs something is "non-dismissible": not merely that clicking a close button
// does nothing, but that no dismissal control exists and no dismissed state is stored anywhere. Both
// halves are asserted below, because a banner that hides itself after a reload is exactly the bug a
// "close button is gone" check alone would miss.

const BANNER = ".promo-bar";
const FALLBACK = /Free shipping on orders of/i;

// Leaving an offer live would discount every later spec's cart. See the same note in
// automatic-offer-pricing.spec.js.
test.afterAll(() => { clearAutomaticOffers(); });

test("while an offer is live the banner shows its message and offers no way to dismiss it", async ({ page }) => {
  const seen = observe(page);
  await withAutomaticOffer({
    offerName: "E2E Banner Offer",
    bannerMessage: "Buy any 2 eligible products and get ₹500 off automatically for every complete pair.",
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const banner = page.locator(BANNER);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Buy any 2 eligible products and get ₹500 off");
  await expect(banner, "the standing shipping line is replaced, not appended").not.toContainText(FALLBACK);

  // No close control of any kind, by class, by role or by accessible name.
  await expect(page.locator(".promo-close"), "no close control").toHaveCount(0);
  await expect(banner.getByRole("button"), "no buttons at all inside the banner").toHaveCount(0);
  await expect(page.getByRole("button", { name: /close|dismiss/i })).toHaveCount(0);

  expect(clean(seen), "the page must be clean").toEqual({
    consoleErrors: [], pageErrors: [], dialogs: [], badResponses: [],
  });
});

test("the banner survives a hard refresh and route navigation, and stores no dismissed state", async ({ page }) => {
  await withAutomaticOffer({ offerName: "E2E Persistent Banner", bannerMessage: "E2E persistent offer message" });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(BANNER)).toContainText("E2E persistent offer message");

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.locator(BANNER), "still there after a hard refresh").toContainText("E2E persistent offer message");

  for (const route of ["/shop", "/cart", "/"]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(BANNER), `still there at ${route}`).toContainText("E2E persistent offer message");
  }

  // Nothing about the banner is written to any client-side store, so there is nothing that could
  // hide it on the next visit.
  const stored = await page.evaluate(() => ({
    local: JSON.stringify(window.localStorage),
    session: JSON.stringify(window.sessionStorage),
    cookies: document.cookie,
  }));
  expect(stored.local, "no dismissal state in localStorage").not.toMatch(/promo|banner|dismiss/i);
  expect(stored.session, "none in sessionStorage").not.toMatch(/promo|banner|dismiss/i);
  expect(stored.cookies, "and none in a cookie").not.toMatch(/promo|banner|dismiss/i);
});

test("with no offer live the banner falls back to the existing shipping and returns message", async ({ page }) => {
  clearAutomaticOffers();

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const banner = page.locator(BANNER);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(FALLBACK);
  await expect(banner).toContainText(/30-day easy returns/i);
  await expect(banner).toHaveAttribute("data-offer-active", "false");
});

test("an administrator's message change reaches the storefront on the next data refresh", async ({ page }) => {
  const offer = await withAutomaticOffer({ offerName: "E2E Editable Banner", bannerMessage: "First wording" });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(BANNER)).toContainText("First wording");

  const account = await admin();
  await account.client.put(`/offers/automatic/admin/${offer.automaticOfferId}`, {
    offerName: "E2E Editable Banner", bannerMessage: "Second wording", requiredQuantity: 2,
    discountPerGroup: 500, minimumOrderSubtotal: 0, scopeType: "ALL_PRODUCTS",
    productIds: [], categoryIds: [], startsAt: "2026-01-01T00:00:00", endsAt: "2030-01-01T00:00:00",
    isActive: true, priority: 0, version: offer.version,
  });

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.locator(BANNER), "the customer sees the new wording").toContainText("Second wording");
  await expect(page.locator(BANNER)).not.toContainText("First wording");
});

test("a scheduled or expired offer shows the fallback, not a promise the cart will not honour", async ({ page }) => {
  await withAutomaticOffer({
    offerName: "E2E Future Banner", bannerMessage: "Not yet live",
    startMinutes: 60, endMinutes: 60 * 24,
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(BANNER)).toContainText(FALLBACK);
  await expect(page.locator(BANNER)).not.toContainText("Not yet live");
  await expect(page.locator(BANNER)).toHaveAttribute("data-offer-active", "false");
});

test("administrator markup never reaches the page as markup", async ({ page }) => {
  const seen = observe(page);
  await withAutomaticOffer({
    offerName: "E2E Injection Banner",
    bannerMessage: "<img src=x onerror=\"window.__owned=1\"><b>Two for ₹500</b>",
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const banner = page.locator(BANNER);
  await expect(banner).toContainText("Two for ₹500");
  expect(await banner.locator("img").count(), "no injected image element").toBe(0);
  expect(await banner.locator("b").count(), "no injected markup at all").toBe(0);
  expect(await page.evaluate(() => window.__owned), "no injected script ran").toBeUndefined();
  expect(clean(seen)).toEqual({ consoleErrors: [], pageErrors: [], dialogs: [], badResponses: [] });
});

test("the banner is readable and does not overflow at desktop, tablet and mobile widths", async ({ page }) => {
  await withAutomaticOffer({
    offerName: "E2E Responsive Banner",
    // Deliberately long: the terms must wrap rather than being clipped or forcing a sideways scroll.
    bannerMessage: "Buy any 2 eligible products and get ₹500 off automatically for every complete pair, "
      + "applied at checkout with no code required across the whole eyewear collection.",
  });

  for (const [label, width, height] of [["desktop", 1280, 900], ["tablet", 768, 1024], ["mobile", 375, 812]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const banner = page.locator(BANNER);
    await expect(banner, `${label} banner visible`).toBeVisible();

    // Two separate claims, because conflating them is how this assertion first went wrong.
    //
    // 1. The document does not scroll sideways. This is the claim that matters to a customer.
    // 2. No element sticking out belongs to the banner. The homepage's logo already overhangs the
    //    left edge at desktop width without causing any scroll — measured identical with and
    //    without an offer — so asserting an empty offender list here would be asserting something
    //    about the navbar, not about this feature. The existing responsive-overflow spec only
    //    covers widths up to 768px, which is why that overhang has never been flagged.
    const report = await overflowReport(page);
    expect(report.scrollWidth, `${label} must not scroll sideways: ${JSON.stringify(report)}`)
      .toBeLessThanOrEqual(report.limit + 1);
    const bannerOffenders = report.offenders.filter((offender) =>
      String(offender.className || "").includes("promo"));
    expect(bannerOffenders, `${label}: the banner itself must not stick out`).toEqual([]);

    const box = await banner.boundingBox();
    expect(box.width, `${label} banner stays inside the viewport`).toBeLessThanOrEqual(width + 1);
    expect(box.height, `${label} banner has real height`).toBeGreaterThan(10);

    // Nothing focusable inside it, so keyboard users are never trapped by a banner they cannot act on.
    expect(await banner.locator("a, button, input, [tabindex]").count(),
      `${label} banner holds no focusable control`).toBe(0);
  }
});

/**
 * Reads the banner's actual painted colours and computes the WCAG contrast ratio in the page.
 *
 * Measured rather than asserted against the hex values in the stylesheet: the reported bug was a
 * black bar, and what matters is what the browser paints after every cascade, media query and
 * inherited rule has had its say — not what one declaration says.
 */
const bannerColours = (page) => page.evaluate(() => {
  const bar = document.querySelector(".promo-bar");
  const paragraph = bar.querySelector("p");
  const rgb = (value) => value.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance = ([r, g, b]) =>
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const background = rgb(getComputedStyle(bar).backgroundColor);
  const text = rgb(getComputedStyle(paragraph).color);
  const lighter = Math.max(luminance(background), luminance(text));
  const darker = Math.min(luminance(background), luminance(text));
  return {
    background, text,
    // The raw computed string as well as the channels, so one banner's colour can be compared
    // directly with another element's without both being parsed first.
    backgroundComputed: getComputedStyle(bar).backgroundColor,
    contrast: Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2)),
    textTransform: getComputedStyle(paragraph).textTransform,
    fontSize: getComputedStyle(paragraph).fontSize,
  };
});

test("a placeholder banner message is never shown to a customer", async ({ page }) => {
  // The exact value that shipped: an administrator typed "message" as filler, and the storefront
  // displayed it — uppercased by the strip's styling — as MESSAGE across the top of every page.
  const offer = await withAutomaticOffer({
    offerName: "tttttt", bannerMessage: "message", requiredQuantity: 2, discountPerGroup: 500,
  });

  // The API reports the generated wording as what customers will see, while keeping the raw value.
  expect(offer.bannerMessage, "the administrator's text is not discarded").toBe("message");
  expect(offer.effectiveBannerMessage, "but it is not what gets shown")
    .toBe("Buy any 2 eligible products and get ₹500 off automatically for every complete pair.");

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const banner = page.locator(BANNER);
  await expect(banner).toContainText("Buy any 2 eligible products and get ₹500 off");
  await expect(banner, "the placeholder must not appear in any case").not.toContainText(/^\s*message\s*$/i);
  const rendered = (await banner.locator("p").textContent()).trim();
  expect(rendered.toLowerCase()).not.toBe("message");
  expect(rendered).not.toMatch(/^(undefined|null|MESSAGE)$/);
  // And the generated wording carries the real configuration, not a hard-coded example.
  const threes = await withAutomaticOffer({
    offerName: "Threes", bannerMessage: "todo", requiredQuantity: 3, discountPerGroup: 1250,
  });
  expect(threes.effectiveBannerMessage).toContain("Buy any 3 eligible products and get ₹1,250 off");
});

test("the banner background is the same colour as the Women collection box, never black", async ({ page }) => {
  await withAutomaticOffer({
    offerName: "E2E Themed Banner",
    bannerMessage: "Buy any 2 eligible products and get ₹500 off automatically for every complete pair.",
  });

  for (const [label, width, height] of [["desktop", 1280, 900], ["tablet", 768, 1024], ["mobile", 375, 812]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const colours = await bannerColours(page);

    // The requirement, stated as a comparison rather than as a hex value: whatever the Women box
    // paints, the offer strip paints. Both read var(--bg-sand), so a change to that token moves them
    // together and this assertion keeps holding — which is the point of comparing instead of pinning.
    // The Women card is on this same page, in CollectionShowcase.
    const womenBackground = await page.evaluate(() => {
      const card = document.querySelector('.collection-card[href="/collections/women"] .collection-card-bg');
      return getComputedStyle(card).backgroundColor;
    });
    expect(colours.backgroundComputed, `${label}: banner must match the Women box`).toBe(womenBackground);

    // And it is not the near-black the strip briefly had.
    const [r, g, b] = colours.background;
    expect(r + g + b, `${label} must not be a dark bar, was rgb(${r},${g},${b})`).toBeGreaterThan(300);
    expect(colours.background, `${label} must not be #1c1c1c`).not.toEqual([28, 28, 28]);

    // Readable, and not shouted in caps.
    expect(colours.contrast, `${label} contrast ${colours.contrast}:1 must clear WCAG AA for body text`)
      .toBeGreaterThanOrEqual(4.5);
    expect(colours.textTransform, `${label}: a sentence must not be shouted in caps`).toBe("none");
  }
});

test("no state turns the banner black again", async ({ page }) => {
  await withAutomaticOffer({ offerName: "E2E Hover Banner", bannerMessage: "Two for ₹500 automatically" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const before = await bannerColours(page);
  // Hover the strip, then move focus through the page, then re-measure. There is nothing focusable
  // inside the banner, so this checks that a nearby :hover/:focus rule cannot repaint it either.
  await page.locator(BANNER).hover();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const after = await bannerColours(page);

  expect(after.background, "hover and focus must not change the banner colour").toEqual(before.background);
  expect(after.contrast).toBeGreaterThanOrEqual(4.5);
});

test("the banner announces itself to assistive technology without hiding the terms", async ({ page }) => {
  await withAutomaticOffer({ offerName: "E2E A11y Banner", bannerMessage: "E2E accessible offer wording" });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // role=status: announced politely when it appears, never interrupting.
  const status = page.locator(`${BANNER} [role="status"]`);
  await expect(status).toHaveCount(1);
  await expect(status).toContainText("E2E accessible offer wording");
  await expect(page.locator(BANNER)).toHaveAttribute("data-offer-active", "true");
});
