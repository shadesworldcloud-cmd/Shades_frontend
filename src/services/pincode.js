// Client-side postal-code rules, deliberately mirroring AddressServiceImpl.normalisePincode on
// the server so the two cannot disagree. India has a fixed national format; every other
// destination is accepted at a generic 3-10 digits rather than guessed at, so a legitimate
// foreign address is never rejected.
//
// The value is handled as a String throughout. Coercing it to a number anywhere would destroy a
// leading zero, which real postal codes have (Spanish "08001").

export const MAX_PINCODE_LENGTH = 10;

const isIndia = (country) => String(country || "").trim().toLowerCase() === "india";

/** Maximum digits accepted for a destination. */
export const pincodeMaxLength = (country) => (isIndia(country) ? 6 : MAX_PINCODE_LENGTH);

/**
 * Strips everything that is not a digit, so pasted text and stray whitespace are sanitised rather
 * than rejected outright, then caps to the destination's length.
 *
 * The cap lives here and NOT in the input's maxLength attribute. maxLength truncates the raw value
 * before React sees it, so pasting "560 001" — a completely normal way to write an Indian PIN —
 * would be cut to "560 00" and sanitise down to "56000": a silently wrong code. Clamping after
 * stripping means the digits survive and only genuine excess is dropped.
 */
export const sanitisePincode = (value, country) =>
  String(value ?? "").replace(/\D+/g, "").slice(0, pincodeMaxLength(country));

/** Returns "" when acceptable, otherwise the message to show. Empty input is not an error here:
 *  required-ness is the form's concern, and complaining before typing starts is hostile. */
export const pincodeError = (value, country) => {
  const digits = String(value ?? "");
  if (digits === "") return "";
  if (!/^[0-9]+$/.test(digits)) return "Pincode must contain digits only.";
  if (isIndia(country)) {
    return /^[1-9][0-9]{5}$/.test(digits) ? "" : "Enter a valid 6-digit Indian PIN code.";
  }
  return digits.length >= 3 && digits.length <= MAX_PINCODE_LENGTH ? "" : "Enter a valid postal code of 3 to 10 digits.";
};

