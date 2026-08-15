// Client-side phone rules, deliberately mirroring IndianMobileValidator on the server so the two
// cannot disagree — the same arrangement pincode.js has with AddressServiceImpl.normalisePincode.
//
// The value is a String everywhere, start to finish. A phone number is not a quantity: coerced to
// a Number it loses a leading zero, "+" becomes NaN, and a long value goes to exponent form. For
// the same reason the inputs use inputMode="numeric" rather than type="number", which would let a
// browser accept "e", "." and "-" and would silently strip information on paste.

/** A canonical stored number is always +91 followed by ten digits. */
export const E164_LENGTH = 13;

/**
 * Accepted national number: exactly ten digits starting 6, 7, 8 or 9. That is the Indian mobile
 * range; landlines and short codes are deliberately out of scope because every flow that collects
 * this is a delivery contact number.
 */
const NATIONAL = /^[6-9][0-9]{9}$/;

export const PHONE_MESSAGE = "Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.";

/**
 * Removes formatting a human might reasonably type — spaces, hyphens, brackets, dots — and keeps a
 * single leading "+" if one was typed.
 *
 * It does NOT strip anything else. That restraint is the point: blindly deleting every unexpected
 * character turns "98765a4321 0" into a ten-digit number and accepts it, so a typo becomes a valid
 * but wrong number. Letters and other junk are left in place precisely so the validator can see
 * them and reject the value.
 */
export const sanitisePhone = (value) => {
  const raw = String(value ?? "").trim();
  if (!SHAPE.test(raw)) return raw; // leave it intact so the validator can see why it is wrong
  const plus = raw.startsWith("+") ? "+" : "";
  return plus + raw.slice(plus.length).replace(/[ -]/g, "");
};

/**
 * The only shapes whose separators may be removed: an optional leading "+", then digits, with
 * single runs of spaces or hyphens allowed only BETWEEN digits.
 *
 * The between-digits part is load-bearing. Stripping "-" wherever it appeared turned the signed
 * value "-9876543210" into "9876543210" and accepted it — an invalid value made valid by its own
 * sanitising, which is exactly the failure mode the brief warns about. A leading or trailing
 * separator now fails the shape and is never stripped.
 *
 * Only spaces and hyphens are treated as formatting. Brackets and dots are not: they are not
 * conventional in Indian mobile numbers, and every character accepted as "formatting" is another
 * way for a typo to be silently normalised into a different valid number.
 */
const SHAPE = /^\+?[0-9]+(?:[ -]+[0-9]+)*$/;

/**
 * Reduces an accepted value to its ten national digits, or null if it is not acceptable.
 *
 * Handles exactly three input shapes and no others: ten national digits, "91" + ten, and
 * "+91" + ten. A doubled country code ("+9191...") has eleven digits after the prefix and fails,
 * rather than being "helpfully" trimmed into something valid.
 */
export const nationalDigits = (value) => {
  const cleaned = sanitisePhone(value);
  if (!/^\+?[0-9]+$/.test(cleaned)) return null;
  const digits = cleaned.replace(/^\+/, "");
  let national = digits;
  if (digits.length === 12 && digits.startsWith("91")) national = digits.slice(2);
  else if (cleaned.startsWith("+") && digits.length !== 12) return null; // a "+" means a country code was intended
  return NATIONAL.test(national) ? national : null;
};

/** The canonical storage form, +91XXXXXXXXXX, or null when the value is not acceptable. */
export const normalisePhone = (value) => {
  const national = nationalDigits(value);
  return national ? `+91${national}` : null;
};

/**
 * Returns "" when acceptable, otherwise the message to show.
 *
 * Empty is not an error here: phone is optional in every flow that collects it, and required-ness
 * is the form's concern. Complaining before typing starts is hostile — same reasoning as
 * pincodeError.
 */
export const phoneError = (value) => {
  if (String(value ?? "").trim() === "") return "";
  return normalisePhone(value) ? "" : PHONE_MESSAGE;
};

/** For display: shows a stored +91XXXXXXXXXX back as its ten digits, leaving anything else alone. */
export const displayPhone = (value) => {
  const stored = String(value ?? "");
  return /^\+91[6-9][0-9]{9}$/.test(stored) ? stored.slice(3) : stored;
};
