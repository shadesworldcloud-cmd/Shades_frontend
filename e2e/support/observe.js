/**
 * Console / network / native-dialog observation for E2E specs.
 *
 * One definition, shared, because the exclusions below are judgement calls and having two specs
 * quietly disagree about what counts as "a clean page" is how a real error starts getting ignored.
 *
 * Nothing is suppressed: native dialogs are recorded and then dismissed only so the run can
 * continue, and the caller still asserts the list is empty.
 *
 * Two exclusions, both deliberate and both narrow:
 *
 *  1. 401 on /auth/me and /auth/refresh. That is how the app asks "is anyone signed in" — a
 *     signed-out visitor is *supposed* to get 401 there, and Chrome logs every 401 as a console
 *     error. Excluding it is what makes the assertion mean "nothing unexpected" instead of
 *     "nothing at all".
 *  2. Anything from accounts.google.com. The Google Sign-In client ID is registered for the dev
 *     origin (:3000), not the E2E one (:3001), so its button endpoint returns 403 here. That is a
 *     property of the test port, not of the application, and it cannot be fixed from this repo.
 *
 * Everything else — any other 4xx/5xx, any uncaught JS error — fails the caller's assertion.
 */

const THIRD_PARTY = /accounts\.google\.com|googleapis\.com|gstatic\.com/;
const GUEST_AUTH_PROBE = /\/auth\/(me|refresh)$/;

const observe = (page) => {
  const seen = { consoleErrors: [], badResponses: [], dialogs: [], pageErrors: [] };

  page.on("dialog", async (dialog) => {
    seen.dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss().catch(() => {});
  });

  page.on("pageerror", (error) => seen.pageErrors.push(String(error).slice(0, 200)));

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // "Failed to load resource" lines carry no URL, so they cannot be attributed here. Network
    // problems are asserted through badResponses below, which does have the URL.
    if (/Failed to load resource/.test(text)) return;
    if (/GSI_LOGGER|gsi\/button/.test(text)) return;
    seen.consoleErrors.push(text.slice(0, 200));
  });

  page.on("response", (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    if (THIRD_PARTY.test(url)) return;
    if (response.status() === 401 && GUEST_AUTH_PROBE.test(url)) return;
    seen.badResponses.push(`${response.status()} ${url.replace(/^https?:\/\/[^/]+/, "")}`);
  });

  return seen;
};

/** Everything that should be empty on a healthy page, as one object for a single assertion. */
const clean = (seen) => ({
  consoleErrors: seen.consoleErrors,
  pageErrors: seen.pageErrors,
  dialogs: seen.dialogs,
  badResponses: seen.badResponses,
});

module.exports = { observe, clean };
