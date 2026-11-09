import { getDeliveryEstimate, checkPincodeServiceability } from "./api";

// Regression: these helpers once passed the un-awaited fetch promise to parseResponse, so every
// call threw and checkout always showed the 3–5 day fallback instead of the Shiprocket date.
const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

afterEach(() => {
  delete global.fetch;
});

test("getDeliveryEstimate returns the parsed Shiprocket estimate", async () => {
  const body = { pincode: "305004", serviceable: true, earliestDate: "2026-11-12", latestDate: "2026-11-13",
    courierName: "DTDC Surface", courierCount: 9, source: "SHIPROCKET" };
  global.fetch = jest.fn(() => Promise.resolve(jsonResponse(body)));

  await expect(getDeliveryEstimate("305004")).resolves.toEqual(body);
  expect(global.fetch.mock.calls[0][0]).toMatch(/\/shiprocket\/delivery-estimate\?pincode=305004$/);
});

test("getDeliveryEstimate rejects on a server error", async () => {
  global.fetch = jest.fn(() => Promise.resolve(jsonResponse({ message: "Enter a valid 6-digit Indian pincode" }, 400)));
  await expect(getDeliveryEstimate("000000")).rejects.toThrow("Enter a valid 6-digit Indian pincode");
});

test("checkPincodeServiceability returns the parsed courier list", async () => {
  const body = { status: 200, data: { available_courier_companies: [], recommended_courier_company_id: null } };
  global.fetch = jest.fn(() => Promise.resolve(jsonResponse(body)));
  await expect(checkPincodeServiceability("560001")).resolves.toEqual(body);
});
