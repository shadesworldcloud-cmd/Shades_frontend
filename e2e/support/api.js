// Real HTTP against the real test backend. No mocking anywhere in this suite — these helpers exist
// only to build fixtures and to read back the database's own view of what the UI did.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const API = process.env.E2E_API_URL || "http://localhost:8081/api";
const BACKEND_DIR = process.env.E2E_BACKEND_DIR
  || "C:/Users/iambh/Desktop/Shades_world/CODEX/sunglass-store-backend";
const MYSQL = process.env.E2E_MYSQL
  || "C:/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe";
const TEST_SCHEMA = process.env.E2E_SCHEMA || "ECOMMERCE_TEST_DB";

// Read from the project's own config rather than hardcoding a credential into the repo.
const dbPassword = () => {
  const properties = fs.readFileSync(path.join(BACKEND_DIR, "src/main/resources/application.properties"), "utf8");
  const match = properties.match(/^spring\.datasource\.password=(.*)$/m);
  return match ? match[1].trim() : "";
};

/**
 * Runs SQL against the TEST schema only. Used for two things a black-box test cannot do through
 * the API: building product fixtures, and asserting what the database actually holds after a
 * checkout. Guarded so it can never be pointed at the development schema.
 */
const sql = (statement) => {
  if (/ECOMMERCE_DB\b/.test(statement)) {
    throw new Error("Refusing to run SQL that references the development schema");
  }
  return execFileSync(MYSQL, ["-u", "root", `-p${dbPassword()}`, "-D", TEST_SCHEMA, "-N", "-B", "-e", statement],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
};

const sqlRows = (statement) => sql(statement).split("\n").filter(Boolean).map((line) => line.split("\t"));
const sqlValue = (statement) => { const rows = sqlRows(statement); return rows.length ? rows[0][0] : null; };

/** A cookie jar + CSRF-aware client, mirroring what services/api.js does in the browser. */
class ApiClient {
  constructor() { this.cookies = new Map(); this.csrf = null; }

  cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  absorb(response) {
    // Node exposes multiple Set-Cookie headers via getSetCookie().
    const raw = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const entry of raw) {
      const [pair] = entry.split(";");
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  async request(method, path, body) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      // Spring rotates the readable CSRF cookie after unsafe requests, so re-sync before each one.
      const csrfResponse = await fetch(`${API}/auth/csrf`, { headers: { Cookie: this.cookieHeader() } });
      this.absorb(csrfResponse);
      this.csrf = (await csrfResponse.json()).token;
      headers["X-XSRF-TOKEN"] = this.csrf;
    }
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${API}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.absorb(response);
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) {
      const error = new Error(payload?.message || `${method} ${path} -> ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  /**
   * A multipart/form-data POST, for the image-upload endpoint.
   *
   * Deliberately does NOT set Content-Type: fetch has to generate it itself so the multipart
   * boundary in the header matches the one in the body. Setting it by hand produces a body the
   * server cannot parse, which surfaces as a confusing 400 about a missing file part.
   */
  async multipart(path, form) {
    const csrfResponse = await fetch(`${API}/auth/csrf`, { headers: { Cookie: this.cookieHeader() } });
    this.absorb(csrfResponse);
    this.csrf = (await csrfResponse.json()).token;
    const headers = { Accept: "application/json", "X-XSRF-TOKEN": this.csrf };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${API}${path}`, { method: "POST", headers, body: form });
    this.absorb(response);
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) {
      const error = new Error(payload?.message || `POST ${path} -> ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  /**
   * Like request(), but waits out AuthRateLimitFilter's 60-second window on a 429.
   * The limits are deliberately low (register 10/min, verify-email 10/min per IP) and every
   * Playwright worker is 127.0.0.1, so a suite that creates a dozen accounts will legitimately
   * trip them. Waiting is the correct response: the alternative would be relaxing a real security
   * control to suit the tests.
   */
  async requestWithRateLimitBackoff(method, path, body, attempts = 3) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.request(method, path, body);
      } catch (error) {
        const rateLimited = error.status === 429 || /too many|rate limit/i.test(error.message || "");
        if (!rateLimited || attempt >= attempts) throw error;
        await new Promise((resolve) => { setTimeout(resolve, 61_000); });
      }
    }
  }

  get(path) { return this.request("GET", path); }
  post(path, body) { return this.request("POST", path, body); }
  put(path, body) { return this.request("PUT", path, body); }
  patch(path, body) { return this.request("PATCH", path, body); }
  del(path) { return this.request("DELETE", path); }
}

/**
 * Registers and signs in a deterministic test customer through the real auth endpoints.
 * Email verification is completed by reading the token out of EMAIL_OUTBOX — recoverable only
 * because the outbox scheduler is disabled on the test backend. With it enabled, delivery blanks
 * the body seconds after sending (and would email a real address).
 */
const createCustomer = async (label) => {
  const stamp = `${label}-${process.pid}-${Date.now()}`;
  const email = `e2e.${stamp}@example.test`;
  const password = "E2ePassw0rd!";
  const client = new ApiClient();
  await client.requestWithRateLimitBackoff("POST", "/auth/register", { name: `E2E ${label}`, email, password, phoneNumber: null });

  // Login is refused until the address is verified, and only a SHA-256 hash of the token is
  // stored, so the raw token has to come from the queued email body. That body survives purely
  // because the test backend runs with EMAIL_OUTBOX_ENABLED=false: delivery blanks it seconds
  // after sending, and would also send to a real inbox.
  const body = sqlValue(`SELECT REPLACE(BODY, CHAR(10), ' ') FROM EMAIL_OUTBOX
      WHERE RECIPIENT = '${email}' AND SUBJECT LIKE '%Verify%' ORDER BY EMAIL_OUTBOX_ID DESC LIMIT 1`);
  const token = body && body.match(/verifyToken=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error(`No verification token found for ${email}. Is EMAIL_OUTBOX_ENABLED=false?`);
  await client.requestWithRateLimitBackoff("POST", "/auth/verify-email", { token });

  await client.requestWithRateLimitBackoff("POST", "/auth/login", { email, password });
  const me = await client.get("/auth/me");
  return { client, email, password, userId: me.userId, name: me.name };
};

/** Promotes an existing account to ADMIN. register() hardcodes CUSTOMER and no endpoint grants
 *  roles, so this row insert is the one unavoidable direct-SQL step in the whole harness. */
const promoteToAdmin = (userId) => {
  sql(`INSERT IGNORE INTO USER_ROLES (USER_ID, ROLE_ID) SELECT ${Number(userId)}, ROLE_ID FROM ROLES WHERE ROLE_NAME='ADMIN'`);
};

module.exports = { API, ApiClient, TEST_SCHEMA, createCustomer, promoteToAdmin, sql, sqlRows, sqlValue };
