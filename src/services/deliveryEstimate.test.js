import * as api from "./api";
import {
  addWorkingDays, clearDeliveryEstimateCache, fallbackEstimate, fetchDeliveryEstimate, formatDeliveryDate,
  formatDeliveryRange, isIndianPincode, lastDeliveryPincode, parseLocalDate, rememberDeliveryPincode,
} from "./deliveryEstimate";

jest.mock("./api", () => ({ getDeliveryEstimate: jest.fn() }));

const shiprocket = { pincode: "560001", serviceable: true, earliestDate: "2026-11-14", latestDate: "2026-11-17",
  courierName: "Xpressbees", courierCount: 3, source: "SHIPROCKET" };

beforeEach(() => {
  jest.clearAllMocks();
  clearDeliveryEstimateCache();
  window.sessionStorage.clear();
});

test("validates Indian pincodes", () => {
  expect(isIndianPincode("560001")).toBe(true);
  expect(isIndianPincode(" 560001 ")).toBe(true);
  ["060001", "56000", "5600011", "abcdef", "", null, undefined].forEach((value) => expect(isIndianPincode(value)).toBe(false));
});

test("parses ISO dates as local calendar dates, never shifting a day", () => {
  const date = parseLocalDate("2026-11-14");
  expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 10, 14]);
  expect(parseLocalDate("2026-11-14T20:00:00").getDate()).toBe(14);
  expect(parseLocalDate("")).toBeNull();
  expect(parseLocalDate(null)).toBeNull();
  expect(parseLocalDate("soon")).toBeNull();
});

test("formats a single day and a range", () => {
  expect(formatDeliveryDate("2026-11-14")).toMatch(/Sat.*14.*Nov/);
  expect(formatDeliveryRange({ earliestDate: "2026-11-14", latestDate: "2026-11-14" })).toMatch(/^Sat.*14.*Nov$/);
  const range = formatDeliveryRange({ earliestDate: "2026-11-14", latestDate: "2026-11-17" });
  expect(range).toMatch(/Sat.*14.*Nov – Tue.*17.*Nov/);
  expect(formatDeliveryRange({ earliestDate: "2026-11-14" })).toMatch(/14.*Nov/);
  expect(formatDeliveryRange(null)).toBe("");
});

test("working days skip Sundays", () => {
  const friday = new Date(2026, 10, 13);
  expect(addWorkingDays(friday, 1).getDate()).toBe(14); // Saturday
  expect(addWorkingDays(friday, 2).getDate()).toBe(16); // Monday
  expect(addWorkingDays(new Date(2026, 10, 15), 0).getDate()).toBe(16); // Sunday -> Monday
});

test("fallback is 3–5 working days after a one-day dispatch, matching the server", () => {
  const estimate = fallbackEstimate("560001", new Date(2026, 10, 10)); // Tuesday
  expect(estimate).toMatchObject({ earliestDate: "2026-11-14", latestDate: "2026-11-17", source: "FALLBACK", serviceable: null });
});

test("fetches from Shiprocket once per pincode and caches the answer", async () => {
  api.getDeliveryEstimate.mockResolvedValue(shiprocket);
  await expect(fetchDeliveryEstimate("560001")).resolves.toEqual(shiprocket);
  await fetchDeliveryEstimate("560001");
  expect(api.getDeliveryEstimate).toHaveBeenCalledTimes(1);
  expect(api.getDeliveryEstimate).toHaveBeenCalledWith("560001");
});

test("an unserviceable answer is passed through so checkout can stop", async () => {
  api.getDeliveryEstimate.mockResolvedValue({ pincode: "194101", serviceable: false, earliestDate: null, latestDate: null, source: "SHIPROCKET" });
  await expect(fetchDeliveryEstimate("194101")).resolves.toMatchObject({ serviceable: false });
});

test("network errors and incomplete answers resolve to the fallback and are retried next time", async () => {
  api.getDeliveryEstimate.mockRejectedValueOnce(new Error("offline"));
  await expect(fetchDeliveryEstimate("560001")).resolves.toMatchObject({ source: "FALLBACK", pincode: "560001" });
  api.getDeliveryEstimate.mockResolvedValueOnce({ serviceable: true });
  await expect(fetchDeliveryEstimate("560001")).resolves.toMatchObject({ source: "FALLBACK" });
  api.getDeliveryEstimate.mockResolvedValueOnce(shiprocket);
  await expect(fetchDeliveryEstimate("560001")).resolves.toEqual(shiprocket);
  expect(api.getDeliveryEstimate).toHaveBeenCalledTimes(3);
});

test("invalid pincodes are not sent to the server", async () => {
  await expect(fetchDeliveryEstimate("123")).resolves.toBeNull();
  expect(api.getDeliveryEstimate).not.toHaveBeenCalled();
});

test("remembers the last valid pincode for the session", () => {
  rememberDeliveryPincode("12");
  expect(lastDeliveryPincode()).toBe("");
  rememberDeliveryPincode("560001");
  expect(lastDeliveryPincode()).toBe("560001");
});
