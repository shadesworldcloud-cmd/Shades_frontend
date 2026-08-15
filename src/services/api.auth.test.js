const answer = (status, payload) => Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(payload) });

beforeEach(() => { jest.resetModules(); global.fetch = jest.fn(); });
afterEach(() => { delete global.fetch; });

test("authentication success discards the pre-login CSRF token before refresh", async () => {
  fetch.mockImplementationOnce(() => answer(200, { token:"before-login" }))
    .mockImplementationOnce(() => answer(200, { userId:4 }))
    .mockImplementationOnce(() => answer(200, { token:"after-login" }))
    .mockImplementationOnce(() => answer(200, { userId:4 }));
  const api = await import("./api");
  await api.login("customer@example.com", "password");
  await api.refreshAccessToken();
  expect(fetch.mock.calls[1][1].headers["X-XSRF-TOKEN"]).toBe("before-login");
  expect(fetch.mock.calls[3][1].headers["X-XSRF-TOKEN"]).toBe("after-login");
});

test("invalid login credentials are submitted only once", async () => {
  fetch.mockImplementationOnce(() => answer(200, { token:"login-token" }))
    .mockImplementationOnce(() => answer(401, { message:"Authentication failed" }));
  const api = await import("./api");
  await expect(api.login("customer@example.com", "incorrect"))
    .rejects.toThrow("Authentication failed");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("/auth/login"))).toHaveLength(1);
});

test("a rejected stale CSRF token is refreshed and the unsafe request is retried once", async () => {
  fetch.mockImplementationOnce(() => answer(200, { token:"stale" }))
    .mockImplementationOnce(() => answer(403, null))
    .mockImplementationOnce(() => answer(200, { token:"current" }))
    .mockImplementationOnce(() => answer(200, { name:"Asha" }));
  const api = await import("./api");
  const result = await api.updateCurrentUser("cookie-session", { name:"Asha", phoneNumber:null });
  expect(result.name).toBe("Asha");
  expect(fetch.mock.calls[1][1].headers["X-XSRF-TOKEN"]).toBe("stale");
  expect(fetch.mock.calls[3][1].headers["X-XSRF-TOKEN"]).toBe("current");
  expect(fetch).toHaveBeenCalledTimes(4);
});

test("sequential account saves synchronize CSRF after Spring rotates the cookie", async () => {
  fetch.mockImplementationOnce(() => answer(200, { token:"profile-token" }))
    .mockImplementationOnce(() => answer(200, { name:"Asha" }))
    .mockImplementationOnce(() => answer(200, { token:"preferences-token" }))
    .mockImplementationOnce(() => answer(200, { emailOrderUpdates:true }));
  const api = await import("./api");
  await api.updateCurrentUser("cookie-session", { name:"Asha", phoneNumber:null });
  await api.updateCommunicationPreferences("cookie-session", { emailOrderUpdates:true });
  expect(fetch.mock.calls[1][1].headers["X-XSRF-TOKEN"]).toBe("profile-token");
  expect(fetch.mock.calls[3][1].headers["X-XSRF-TOKEN"]).toBe("preferences-token");
});

test("concurrent account saves share one CSRF token instead of racing the cookie", async () => {
  let releaseCsrf;
  fetch.mockImplementation((url) => {
    if (url.endsWith("/auth/csrf")) return new Promise((resolve) => { releaseCsrf = resolve; });
    return answer(200, { name:"Asha" });
  });
  const api = await import("./api");
  const preferences = api.updateCommunicationPreferences("cookie-session", { emailOrderUpdates:true });
  const profile = api.updateCurrentUser("cookie-session", { name:"Asha", phoneNumber:null });
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(1);
  releaseCsrf(await answer(200, { token:"one-shared-token" }));
  await Promise.all([preferences, profile]);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[1][1].headers["X-XSRF-TOKEN"]).toBe("one-shared-token");
  expect(fetch.mock.calls[2][1].headers["X-XSRF-TOKEN"]).toBe("one-shared-token");
});

test("an account save recovers when access expiry and stale CSRF happen together", async () => {
  fetch.mockImplementationOnce(() => answer(200, { token:"stale" }))
    .mockImplementationOnce(() => answer(401, null))
    .mockImplementationOnce(() => answer(200, { token:"current-but-expired" }))
    .mockImplementationOnce(() => answer(401, null))
    .mockImplementationOnce(() => answer(200, { token:"refresh-token" }))
    .mockImplementationOnce(() => answer(200, { userId:4 }))
    .mockImplementationOnce(() => answer(200, { token:"post-refresh-token" }))
    .mockImplementationOnce(() => answer(200, { name:"Asha" }));
  const api = await import("./api");
  const result = await api.updateCurrentUser("cookie-session", { name:"Asha", phoneNumber:null });
  expect(result.name).toBe("Asha");
  expect(fetch.mock.calls[4][0]).toContain("/auth/csrf");
  expect(fetch.mock.calls[5][1].headers["X-XSRF-TOKEN"]).toBe("refresh-token");
  expect(fetch.mock.calls[7][1].headers["X-XSRF-TOKEN"]).toBe("post-refresh-token");
});

test("stable Spring page metadata is normalized for existing catalogue consumers", async () => {
  fetch.mockImplementationOnce(() => answer(200, { content:[{ productId:1 }], page:{ number:0, size:20, totalElements:1, totalPages:1 } }));
  const api = await import("./api");
  const page = await api.getStoreProducts();
  expect(page.content).toHaveLength(1);
  expect(page.totalElements).toBe(1);
  expect(page.totalPages).toBe(1);
});

describe("sign-out is idempotent", () => {
  // Reproduced against the real backend: a missing XSRF cookie, or a token that no longer matches
  // the cookie, both return 401 with an EMPTY body. parseResponse turned that into
  // "Something went wrong. Please try again." — the error users actually saw.
  test("a 401 with an empty body no longer throws", async () => {
    fetch.mockImplementationOnce(() => answer(200, { token: "t1" }))
      .mockImplementationOnce(() => answer(401, null))
      .mockImplementationOnce(() => answer(200, { token: "t2" }))
      .mockImplementationOnce(() => answer(401, null));
    const api = await import("./api");
    await expect(api.logout()).resolves.toEqual({ message: "Already signed out" });
  });

  test("logout retries once with a fresh CSRF token, like every other unsafe call", async () => {
    fetch.mockImplementationOnce(() => answer(200, { token: "stale" }))
      .mockImplementationOnce(() => answer(401, null))
      .mockImplementationOnce(() => answer(200, { token: "fresh" }))
      .mockImplementationOnce(() => answer(200, { message: "Logged out successfully" }));
    const api = await import("./api");
    await expect(api.logout()).resolves.toEqual({ message: "Logged out successfully" });
    const logoutCalls = fetch.mock.calls.filter(([url]) => url.endsWith("/auth/logout"));
    expect(logoutCalls).toHaveLength(2);
    expect(logoutCalls[0][1].headers["X-XSRF-TOKEN"]).toBe("stale");
    expect(logoutCalls[1][1].headers["X-XSRF-TOKEN"]).toBe("fresh");
  });

  test("a 403 is also treated as already signed out", async () => {
    fetch.mockImplementationOnce(() => answer(200, { token: "t1" }))
      .mockImplementationOnce(() => answer(403, null))
      .mockImplementationOnce(() => answer(200, { token: "t2" }))
      .mockImplementationOnce(() => answer(403, null));
    const api = await import("./api");
    await expect(api.logout()).resolves.toEqual({ message: "Already signed out" });
  });

  test("a genuine server failure is still surfaced rather than swallowed", async () => {
    fetch.mockImplementationOnce(() => answer(200, { token: "t1" }))
      .mockImplementationOnce(() => answer(500, { message: "Database unavailable" }));
    const api = await import("./api");
    await expect(api.logout()).rejects.toThrow("Database unavailable");
  });

  test("a network failure is still surfaced", async () => {
    fetch.mockImplementationOnce(() => answer(200, { token: "t1" }))
      .mockImplementationOnce(() => Promise.reject(new Error("Failed to fetch")));
    const api = await import("./api");
    await expect(api.logout()).rejects.toThrow("Failed to fetch");
  });

  test("a 204 with no body is a success, not a parse failure", async () => {
    fetch.mockImplementationOnce(() => answer(200, { token: "t1" }))
      .mockImplementationOnce(() => ({ status: 204, ok: true, json: () => Promise.reject(new Error("no body")) }));
    const api = await import("./api");
    await expect(api.logout()).resolves.toBeNull();
  });
});
