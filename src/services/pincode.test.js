import { pincodeError, pincodeMaxLength, sanitisePincode } from "./pincode";

describe("sanitisePincode", () => {
  test("keeps digits and drops everything else", () => {
    expect(sanitisePincode("560001")).toBe("560001");
    expect(sanitisePincode("560A01")).toBe("56001");
    expect(sanitisePincode("560-001")).toBe("560001");
    expect(sanitisePincode("abc")).toBe("");
  });

  test("strips whitespace of every kind, including pasted newlines and tabs", () => {
    expect(sanitisePincode(" 560 001 ")).toBe("560001");
    expect(sanitisePincode("560\t001\n")).toBe("560001");
    expect(sanitisePincode(" 560001")).toBe("560001");
  });

  test("preserves a leading zero, because it is a string and not a number", () => {
    expect(sanitisePincode("08001")).toBe("08001");
    expect(sanitisePincode("000123")).toBe("000123");
  });

  test("caps a long paste instead of overflowing the column", () => {
    expect(sanitisePincode("1234567890123456")).toBe("1234567890");
  });

  test("tolerates null and undefined", () => {
    expect(sanitisePincode(null)).toBe("");
    expect(sanitisePincode(undefined)).toBe("");
  });
});

describe("pincodeError", () => {
  test("says nothing while the field is still empty", () => {
    expect(pincodeError("", "India")).toBe("");
  });

  test("accepts a valid Indian PIN code", () => {
    expect(pincodeError("560001", "India")).toBe("");
    expect(pincodeError("110001", "india")).toBe("");
  });

  test("rejects an Indian PIN code of the wrong length or starting with zero", () => {
    expect(pincodeError("56001", "India")).toMatch(/6-digit/);
    expect(pincodeError("5600012", "India")).toMatch(/6-digit/);
    expect(pincodeError("060001", "India")).toMatch(/6-digit/);
  });

  test("accepts a foreign postal code with a leading zero", () => {
    expect(pincodeError("08001", "Spain")).toBe("");
  });

  test("applies a generic range to other countries rather than guessing their format", () => {
    expect(pincodeError("12", "Spain")).toMatch(/3 to 10/);
    expect(pincodeError("12345678901", "Spain")).toMatch(/3 to 10/);
    expect(pincodeError("1234567890", "Australia")).toBe("");
  });

  test("mirrors the server rule, so the two cannot disagree", () => {
    // AddressServiceImpl.normalisePincode: digits only, India ^[1-9][0-9]{5}$, else 3-10 digits.
    expect(pincodeError("560001", "India")).toBe("");
    expect(pincodeError("060001", "India")).not.toBe("");
    expect(pincodeError("08001", "Spain")).toBe("");
    expect(pincodeError("12", "Spain")).not.toBe("");
  });
});

describe("pincodeMaxLength", () => {
  test("stops typing at six for India and ten elsewhere", () => {
    expect(pincodeMaxLength("India")).toBe(6);
    expect(pincodeMaxLength(" india ")).toBe(6);
    expect(pincodeMaxLength("Spain")).toBe(10);
    expect(pincodeMaxLength(undefined)).toBe(10);
  });
});

describe("the cap is applied after stripping, not before", () => {
  test("a realistically formatted Indian PIN survives its spaces", () => {
    // Regression: with maxLength=6 on the input, the browser truncated the raw paste "560 001"
    // to "560 00" before React saw it, and sanitising then produced a silently wrong "56000".
    expect(sanitisePincode("560 001", "India")).toBe("560001");
    expect(pincodeError(sanitisePincode("560 001", "India"), "India")).toBe("");
  });

  test("punctuated and multi-line pastes keep all their digits", () => {
    expect(sanitisePincode("  12a3 45\n6  ", "India")).toBe("123456");
    expect(sanitisePincode("560-001", "India")).toBe("560001");
  });

  test("genuine excess is still dropped, per country", () => {
    expect(sanitisePincode("5600012345", "India")).toBe("560001");
    expect(sanitisePincode("1234567890123", "Spain")).toBe("1234567890");
  });
});
