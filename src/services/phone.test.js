import { displayPhone, nationalDigits, normalisePhone, phoneError, PHONE_MESSAGE, sanitisePhone } from "./phone";

// These cases are mirrored by IndianMobileValidatorTest on the server. If one side changes and the
// other does not, the two files disagree and one of them fails — which is the point of keeping the
// rules in a single shared shape rather than re-deriving them per form.

test("accepts a plain ten-digit mobile in every valid leading digit", () => {
  for (const number of ["6123456789", "7123456789", "8123456789", "9876543210"]) {
    expect(normalisePhone(number)).toBe(`+91${number}`);
    expect(phoneError(number)).toBe("");
  }
});

test("accepts the 91 and +91 country-code forms", () => {
  expect(normalisePhone("919876543210")).toBe("+919876543210");
  expect(normalisePhone("+919876543210")).toBe("+919876543210");
  expect(phoneError("+91 98765 43210")).toBe("");
});

test("accepts human formatting and normalises it away", () => {
  for (const written of ["98765 43210", "98765-43210", "+91 98765-43210", "+91-98765-43210"]) {
    expect(normalisePhone(written)).toBe("+919876543210");
  }
});

test("rejects the wrong number of national digits", () => {
  for (const number of ["987654321", "98765432101", "1", ""]) {
    if (number === "") continue; // empty is the form's concern, not the validator's
    expect(normalisePhone(number)).toBeNull();
  }
  expect(phoneError("987654321")).toBe(PHONE_MESSAGE);
});

test("rejects invalid starting digits", () => {
  for (const number of ["0123456789", "1234567890", "5123456789"]) {
    expect(normalisePhone(number)).toBeNull();
  }
});

test("rejects letters, signs, decimals and extensions", () => {
  for (const value of ["98765abcde", "9876543210x12", "+9876543210e5", "9876543210.0", "-9876543210", "98765 4321O", "(98765) 43210", "98765.43210"]) {
    expect(normalisePhone(value)).toBeNull();
  }
});

test("a repeated country code is rejected rather than trimmed into validity", () => {
  // The trap this guards: stripping "91" repeatedly would turn +919198765432 into something valid.
  for (const value of ["+91919876543210", "9191987654321", "+91+919876543210", "919876543210 91"]) {
    expect(normalisePhone(value)).toBeNull();
  }
});

test("sanitisePhone strips only formatting, never characters that would mask an invalid value", () => {
  expect(sanitisePhone("  98765 43210  ")).toBe("9876543210");
  expect(sanitisePhone("+91-98765-43210")).toBe("+919876543210");
  // Letters survive sanitising precisely so validation can see and reject them.
  expect(sanitisePhone("98765a4321 0")).toContain("a");
  expect(normalisePhone("98765a4321 0")).toBeNull();
});

test("empty input is not an error, because phone is optional everywhere it is collected", () => {
  expect(phoneError("")).toBe("");
  expect(phoneError("   ")).toBe("");
  expect(phoneError(null)).toBe("");
  expect(phoneError(undefined)).toBe("");
});

test("nationalDigits returns the ten digits without the country code", () => {
  expect(nationalDigits("+919876543210")).toBe("9876543210");
  expect(nationalDigits("9876543210")).toBe("9876543210");
  expect(nationalDigits("nope")).toBeNull();
});

test("displayPhone shows a stored E.164 value back as ten digits and leaves anything else alone", () => {
  expect(displayPhone("+919876543210")).toBe("9876543210");
  expect(displayPhone("9876543210")).toBe("9876543210");
  // A legacy value that was never normalised must be shown as-is, not mangled.
  expect(displayPhone("0221234567")).toBe("0221234567");
  expect(displayPhone("")).toBe("");
});

test("a phone value is never treated as a number", () => {
  // Regression guard: Number("+919876543210") is NaN and Number("0987654321") drops the zero.
  expect(typeof normalisePhone("9876543210")).toBe("string");
  expect(normalisePhone("0987654321")).toBeNull();
});
