// Expected-delivery dates for the storefront, backed by the server's Shiprocket estimate
// (GET /api/shiprocket/delivery-estimate). The server already applies courier ETDs, the store's
// dispatch time and a safe fallback, so this module only fetches, caches and formats.

import { getDeliveryEstimate } from "./api";

const INDIAN_PINCODE = /^[1-9][0-9]{5}$/;
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map();
const LAST_PINCODE_KEY = "sw:delivery-pincode";

export const FALLBACK_MIN_DAYS = 3;
export const FALLBACK_MAX_DAYS = 5;

export const isIndianPincode = (value) => INDIAN_PINCODE.test(String(value ?? "").trim());

/**
 * "2026-11-14" -> a Date at local midnight. new Date("2026-11-14") would be UTC midnight, which
 * shows as the previous day for anyone west of UTC; parsing the parts keeps the calendar date.
 */
export const parseLocalDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Sat, 14 Nov" */
export const formatDeliveryDate = (value) => {
  const date = parseLocalDate(value);
  return date ? date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "";
};

/** "Sat, 14 Nov" for a single day, "Sat, 14 Nov – Tue, 17 Nov" for a range. */
export const formatDeliveryRange = (estimate) => {
  const start = parseLocalDate(estimate?.earliestDate);
  const end = parseLocalDate(estimate?.latestDate) || start;
  if (!start) return "";
  if (sameDay(start, end) || end < start) return formatDeliveryDate(start);
  return `${formatDeliveryDate(start)} – ${formatDeliveryDate(end)}`;
};

/** Monday–Saturday working days, the same rule the server uses. */
export const addWorkingDays = (start, days) => {
  const result = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    if (result.getDay() !== 0) remaining -= 1;
  }
  if (result.getDay() === 0) result.setDate(result.getDate() + 1);
  return result;
};

const isoDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Standard 3–5 working days after a one-day dispatch, for when the server cannot be reached. */
export const fallbackEstimate = (pincode = null, today = new Date()) => {
  const dispatched = addWorkingDays(today, 1);
  return {
    pincode, serviceable: null, courierName: null, courierCount: 0, source: "FALLBACK",
    earliestDate: isoDate(addWorkingDays(dispatched, FALLBACK_MIN_DAYS)),
    latestDate: isoDate(addWorkingDays(dispatched, FALLBACK_MAX_DAYS)),
  };
};

/**
 * Estimate for a 6-digit Indian pincode. Never rejects: network or server errors resolve to the
 * standard fallback window, so checkout is never blocked by a Shiprocket outage. Only a definite
 * "not serviceable" answer (serviceable === false) should stop a purchase.
 */
export const fetchDeliveryEstimate = (pincode) => {
  const cleaned = String(pincode ?? "").trim();
  if (!isIndianPincode(cleaned)) return Promise.resolve(null);
  const hit = cache.get(cleaned);
  if (hit && hit.expiresAt > Date.now()) return hit.promise;

  const promise = getDeliveryEstimate(cleaned)
    .then((estimate) => {
      if (!estimate || (estimate.serviceable !== false && !estimate.earliestDate)) {
        throw new Error("Incomplete delivery estimate");
      }
      return estimate;
    })
    .catch(() => {
      cache.delete(cleaned); // do not remember failures
      return fallbackEstimate(cleaned);
    });
  cache.set(cleaned, { promise, expiresAt: Date.now() + CACHE_TTL_MS });
  return promise;
};

export const clearDeliveryEstimateCache = () => cache.clear();

export const rememberDeliveryPincode = (pincode) => {
  try { if (isIndianPincode(pincode)) window.sessionStorage.setItem(LAST_PINCODE_KEY, pincode); } catch { /* storage unavailable */ }
};

export const lastDeliveryPincode = () => {
  try { return window.sessionStorage.getItem(LAST_PINCODE_KEY) || ""; } catch { return ""; }
};
