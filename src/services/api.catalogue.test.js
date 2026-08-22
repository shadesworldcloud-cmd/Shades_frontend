const answer = (status, payload) => Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(payload) });

beforeEach(() => { jest.resetModules(); global.fetch = jest.fn(); });
afterEach(() => { delete global.fetch; });

/**
 * getStoreProducts has to page. PaginationConfig on the server calls setMaxPageSize(200), so a
 * request for a bigger page is clamped and answers with 200 rows and no sign that anything was
 * left out — which capped the storefront at 200 products and made the Men/Women/Unisex filters
 * undercount a 256-product catalogue. The failure mode is a silent truncation, not an error, so
 * these tests assert on the row count and the pages requested rather than on a thrown message.
 */
const productPage = (ids, { totalPages, totalElements }) => ({
  content: ids.map((id) => ({ productId: id, productName: `Product ${id}` })),
  page: { size: 200, number: 0, totalPages, totalElements },
});

const range = (from, to) => Array.from({ length: to - from + 1 }, (unused, index) => from + index);

test("a catalogue larger than one page is fetched in full", async () => {
  fetch.mockImplementationOnce(() => answer(200, productPage(range(1, 200), { totalPages: 2, totalElements: 256 })))
    .mockImplementationOnce(() => answer(200, productPage(range(201, 256), { totalPages: 2, totalElements: 256 })));
  const api = await import("./api");

  const result = await api.getStoreProducts();

  expect(result.content).toHaveLength(256);
  expect(result.content[0].productId).toBe(1);
  expect(result.content[255].productId).toBe(256);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][0]).toContain("page=0");
  expect(fetch.mock.calls[1][0]).toContain("page=1");
});

test("every page is requested with the same total ordering, so no row is duplicated or skipped", async () => {
  fetch.mockImplementationOnce(() => answer(200, productPage(range(1, 200), { totalPages: 3, totalElements: 500 })))
    .mockImplementationOnce(() => answer(200, productPage(range(201, 400), { totalPages: 3, totalElements: 500 })))
    .mockImplementationOnce(() => answer(200, productPage(range(401, 500), { totalPages: 3, totalElements: 500 })));
  const api = await import("./api");

  const result = await api.getStoreProducts();

  expect(result.content).toHaveLength(500);
  expect(new Set(result.content.map((item) => item.productId)).size).toBe(500);
  fetch.mock.calls.forEach(([url]) => {
    expect(url).toContain("sort=productId,desc");
    expect(url).toContain("size=200");
  });
});

test("a single-page catalogue costs exactly one request", async () => {
  fetch.mockImplementationOnce(() => answer(200, productPage(range(1, 12), { totalPages: 1, totalElements: 12 })));
  const api = await import("./api");

  const result = await api.getStoreProducts();

  expect(result.content).toHaveLength(12);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("the returned pagination describes the assembled list, not the first page of it", async () => {
  fetch.mockImplementationOnce(() => answer(200, productPage(range(1, 200), { totalPages: 2, totalElements: 256 })))
    .mockImplementationOnce(() => answer(200, productPage(range(201, 256), { totalPages: 2, totalElements: 256 })));
  const api = await import("./api");

  const result = await api.getStoreProducts();

  // A later reader must not be told there is another page waiting when the list is already whole.
  expect(result.totalPages).toBe(1);
  expect(result.page.totalPages).toBe(1);
  expect(result.totalElements).toBe(256);
  expect(result.numberOfElements).toBe(256);
});

test("a failure on a later page is reported rather than silently returning a short catalogue", async () => {
  fetch.mockImplementationOnce(() => answer(200, productPage(range(1, 200), { totalPages: 2, totalElements: 256 })))
    .mockImplementationOnce(() => answer(500, { message: "Catalogue unavailable" }));
  const api = await import("./api");

  await expect(api.getStoreProducts()).rejects.toThrow("Catalogue unavailable");
});
