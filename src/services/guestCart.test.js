import { clearGuestCart, readGuestCart, writeGuestCart } from "./guestCart";

const KEY = "shades_world_guest_cart";
const stored = () => JSON.parse(window.localStorage.getItem(KEY));

beforeEach(() => window.localStorage.clear());

test("a written bag reads back identically", () => {
  writeGuestCart({ "20:22": 2, "20:23": 1 });
  expect(readGuestCart()).toEqual({ "20:22": 2, "20:23": 1 });
});

test("only the key and quantity are stored — never price or availability", () => {
  writeGuestCart({ "20:22": 2 });
  // Prices and stock are re-derived from the live catalogue on restore, so a bag saved before
  // a price change must not carry yesterday's price back with it.
  expect(JSON.stringify(stored())).not.toMatch(/price|quantityAvailable|amount/i);
  expect(stored().items).toEqual({ "20:22": 2 });
});

test("an empty bag removes the key rather than leaving an empty husk", () => {
  writeGuestCart({ "20:22": 1 });
  writeGuestCart({});
  expect(window.localStorage.getItem(KEY)).toBeNull();
});

test("clearGuestCart removes the key", () => {
  writeGuestCart({ "20:22": 1 });
  clearGuestCart();
  expect(window.localStorage.getItem(KEY)).toBeNull();
  expect(readGuestCart()).toEqual({});
});

test("a corrupt payload yields an empty bag and is cleared", () => {
  window.localStorage.setItem(KEY, "{not json");
  expect(readGuestCart()).toEqual({});
  expect(window.localStorage.getItem(KEY)).toBeNull();
});

test("a payload from a future schema version is discarded", () => {
  window.localStorage.setItem(KEY, JSON.stringify({ version: 99, savedAt: Date.now(), items: { "20:22": 1 } }));
  expect(readGuestCart()).toEqual({});
});

test("a bag older than the retention window is discarded", () => {
  const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
  window.localStorage.setItem(KEY, JSON.stringify({ version: 1, savedAt: eightDaysAgo, items: { "20:22": 1 } }));
  expect(readGuestCart()).toEqual({});
});

test("a bag saved yesterday survives", () => {
  const yesterday = Date.now() - 24 * 60 * 60 * 1000;
  window.localStorage.setItem(KEY, JSON.stringify({ version: 1, savedAt: yesterday, items: { "20:22": 3 } }));
  expect(readGuestCart()).toEqual({ "20:22": 3 });
});

test("one malformed line does not cost the shopper the rest of the bag", () => {
  window.localStorage.setItem(KEY, JSON.stringify({
    version: 1, savedAt: Date.now(),
    items: { "20:22": 2, "notakey": 5, "20:23": 0, "20:24": -1, "20:25": "3", "20:26": 1.5, "20:27": 1 },
  }));
  expect(readGuestCart()).toEqual({ "20:22": 2, "20:27": 1 });
});

test("a variant-less key is not persisted", () => {
  // Such a key never reached the server and cannot be merged into an account cart,
  // so restoring it would produce a line no API call can reconcile.
  writeGuestCart({ "20": 1, "20:22": 1 });
  expect(readGuestCart()).toEqual({ "20:22": 1 });
});

test("an absurd quantity is rejected rather than restored", () => {
  writeGuestCart({ "20:22": 100000 });
  expect(readGuestCart()).toEqual({});
});

test("read and write survive localStorage throwing", () => {
  const original = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() { throw new Error("SecurityError: storage is disabled"); },
  });
  expect(() => writeGuestCart({ "20:22": 1 })).not.toThrow();
  expect(readGuestCart()).toEqual({});
  expect(() => clearGuestCart()).not.toThrow();
  Object.defineProperty(window, "localStorage", original);
});
