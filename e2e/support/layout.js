// Shared layout probes.
//
// overflowReport lives here rather than inside a spec on purpose: the last round of hardening
// root-caused four drifted copies of one buy-and-checkout helper, and a check this fiddly is
// exactly the kind that gets pasted into a second spec and then quietly diverges from the first.

/** The narrowest viewports the storefront and the admin shell both have to survive. */
const WIDTHS = [
  { name: "small phone", width: 320, height: 720 },
  { name: "phone", width: 375, height: 812 },
  { name: "large phone", width: 414, height: 896 },
  { name: "tablet", width: 768, height: 1024 },
];

/** The elements actually sticking out, so a failure names the culprit instead of just the page. */
const overflowReport = (page) => page.evaluate(() => {
  // getBoundingClientRect is viewport-relative, so the left/right numbers below only mean anything
  // at scrollLeft 0. Playwright's click() scrolls a target into view, which on an already-overflowing
  // page leaves the document scrolled sideways and every rect shifted negative — reporting phantom
  // offenders on the left while hiding real ones on the right. Vertical scroll is left alone.
  window.scrollTo(0, window.scrollY);

  const limit = document.documentElement.clientWidth;

  // A child sticking out of a deliberate horizontal scroller — the admin's section nav below
  // 820px, the email outbox's 1050px-wide table — is that scroller doing its job, not a layout
  // defect. The container itself is still measured, so one that is genuinely too wide for the
  // viewport is still caught; only its own scrolled content is exempt.
  const insideScroller = (node) => {
    for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const overflowX = getComputedStyle(parent).overflowX;
      if ((overflowX === "auto" || overflowX === "scroll") && parent.scrollWidth > parent.clientWidth) return true;
    }
    return false;
  };

  const offenders = [];
  for (const node of document.querySelectorAll("body *")) {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const style = getComputedStyle(node);
    if (style.position === "fixed" || style.visibility === "hidden" || style.display === "none") continue;
    if (rect.right > limit + 1 || rect.left < -1) {
      if (insideScroller(node)) continue;
      offenders.push({
        tag: node.tagName.toLowerCase(),
        className: String(node.className || "").slice(0, 60),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      });
    }
  }

  return {
    limit,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    // Innermost offenders are the useful ones; a parent overflows because a child does.
    offenders: offenders.slice(-6),
  };
});

/** True when the page is wider than its own viewport, by either measure the report collects. */
const overflows = (report) => report.scrollWidth > report.limit + 1 || report.offenders.length > 0;

module.exports = { WIDTHS, overflowReport, overflows };
