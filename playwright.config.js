// @ts-nocheck
const { defineConfig, devices } = require("@playwright/test");

// The suite runs the real frontend against the real backend and a real MySQL schema. Nothing is
// mocked: every assertion below is the actual application talking to ECOMMERCE_TEST_DB.
//
// ---------------------------------------------------------------------------------------------
// Bringing the stack up. All four env vars on the backend are load-bearing; CORS_ORIGINS is the
// one that is easy to miss and expensive to miss, so read the note under it before running.
//
//   # 1. Test backend on :8081
//   SERVER_PORT=8081 \
//   DB_URL="jdbc:mysql://localhost:3306/ECOMMERCE_TEST_DB?useSSL=false&serverTimezone=UTC&allowPublicKeyRetrieval=true" \
//   CORS_ORIGINS="http://localhost:3001" \
//   EMAIL_OUTBOX_ENABLED=false \
//   UNPAID_ORDER_EXPIRY_ENABLED=false \
//   java -jar ../sunglass-store-backend/target/sunglass-store-backend-1.0.0.jar
//
//   # 2. Test frontend on :3001, pointed at it
//   PORT=3001 BROWSER=none REACT_APP_API_URL=http://localhost:8081/api npx react-scripts start
//
//   # 3. Run
//   E2E_BASE_URL=http://localhost:3001 E2E_API_URL=http://localhost:8081/api npx playwright test
//
// CORS_ORIGINS defaults to localhost:3000 and 5173 — NOT 3001. Omit it and every browser request
// to :8081 is blocked, while the fixtures (which are server-side fetch, not browser XHR) keep
// working. So products get created, the pages render, and responsive-overflow.spec.js reports
// four green tests that measured pages with no products on them. A wrong CORS origin does not
// look like a failure here; it looks like a pass. Check the browser console before trusting a run.
//
// EMAIL_OUTBOX_ENABLED=false is mandatory, not a convenience: with delivery on, the app mails real
// addresses AND blanks the verification token seconds after sending, which is the only way a test
// can verify an account.
// ---------------------------------------------------------------------------------------------
//
// Two hard constraints shape this file:
//  1. Specs live in ./e2e, never under src/. CRA sets jest `roots` to <rootDir>/src, so a spec
//     inside src/ would be collected by `react-scripts test` and fail on the Playwright imports.
//  2. workers: 1. AuthRateLimitFilter caps auth attempts per IP per minute and every worker is
//     127.0.0.1, so parallel workers would rate-limit each other into flakiness rather than
//     finding real bugs.
//
//     This has been re-checked and it is not a limitation worth chipping away at, because the
//     limiter is a throughput ceiling rather than a contention problem. The specs create 28
//     accounts plus one cached admin per worker *process*, and POST /api/auth/register allows 10
//     per IP per 60s (verify-email likewise; login 20). So the suite needs ~3 minutes of register
//     budget no matter how many workers run — parallelism cannot buy any of it back, and it makes
//     things strictly worse in two ways: each extra worker adds another admin registration, and
//     bunched registrations turn the 61s backoff from occasional into routine. Two backoffs inside
//     one test exceed the 150s timeout, so the failure mode is a timeout, not a retry.
//
//     Concurrency here is gated on creating fewer accounts (sharing verified fixtures across
//     specs), never on relaxing the filter — that is a real security control, not test scaffolding.
//
// There is deliberately no root tsconfig.json anywhere in this project: react-scripts switches to
// TypeScript mode on its mere existence and `npm start` then breaks.
module.exports = defineConfig({
  testDir: "./e2e",
  // Sequential and single-worker: see the rate-limit note above.
  workers: 1,
  fullyParallel: false,
  // No retries. A retry would hide exactly the flakiness worth knowing about, and the brief is
  // explicit that assertions must not be weakened.
  retries: 0,
  // Generous enough to absorb one AuthRateLimitFilter window (60s) when the suite trips it.
  timeout: 150_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: "e2e-results.json" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3001",
    // NOTE: `channel` belongs to the Chrome project, not here — a global channel is inherited by
    // every project and makes Firefox fail to launch with `Unsupported firefox channel "chrome"`.
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
    actionTimeout: 15_000,
  },
  // Chrome uses the installed browser. `channel` must live on the project, never in the shared
  // `use` block above, or every other project inherits it and fails with
  // `Unsupported firefox channel "chrome"`.
  //
  // Firefox is opt-in via E2E_FIREFOX=1. `npx playwright install firefox` succeeds here (337 MB,
  // INSTALLATION_COMPLETE, firefox.exe present) but launching it fails with `spawn UNKNOWN` —
  // the OS refuses to execute the downloaded binary, which is an environment policy issue
  // (SmartScreen / endpoint protection), not a Playwright or config one. The project is left
  // wired up and correct so a single env var turns it on wherever that block does not apply.
  // The suite is otherwise engine-agnostic: the only Chromium-only assertion is the clipboard
  // paste in checkout-inventory-cancel.spec.js, which already guards on browserName.
  projects: [
    { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    ...(process.env.E2E_FIREFOX === "1"
      ? [{ name: "firefox", use: { ...devices["Desktop Firefox"] } }]
      : []),
  ],
});
