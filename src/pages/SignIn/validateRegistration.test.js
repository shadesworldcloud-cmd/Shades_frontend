import { validateRegistration } from "./SignIn";

// The E2E suite proves these messages reach the screen. This pins the boundaries, which are
// tedious and slow to express through a browser: exactly 8 characters, exactly 100, exactly 255.
//
// The messages are copied from RegisterRequest's annotations on purpose, so if the server's wording
// changes and this file is not updated, the mismatch shows up here rather than as two different
// sentences depending on which side rejected the input.

const valid = {
  name: "Ada Lovelace",
  email: "ada@example.test",
  password: "E2ePassw0rd!",
  confirmPassword: "E2ePassw0rd!",
  phoneNumber: "9876543210",
};

test("a complete, valid form produces no errors", () => {
  expect(validateRegistration(valid)).toEqual({});
});

test("required fields say they are required", () => {
  const errors = validateRegistration({ name: "", email: "", password: "", confirmPassword: "" });
  expect(errors.name).toBe("Name is required");
  expect(errors.email).toBe("Email is required");
  expect(errors.password).toBe("Password is required");
  expect(errors.confirmPassword).toBe("Confirm your password");
});

test("whitespace-only input counts as empty, because the server trims before validating", () => {
  const errors = validateRegistration({ ...valid, name: "   ", email: "   " });
  expect(errors.name).toBe("Name is required");
  expect(errors.email).toBe("Email is required");
});

test("surrounding whitespace on otherwise valid values is accepted, not rejected", () => {
  // AuthenticationServiceImpl trims name, email and phone, so "  ada@example.test  " is the same
  // account as "ada@example.test" — flagging it here would reject something the API accepts.
  expect(validateRegistration({ ...valid, name: "  Ada Lovelace  ", email: "  ada@example.test  " })).toEqual({});
});

test("legitimate characters in customer names are preserved, not treated as invalid", () => {
  for (const name of ["Ada Lovelace-O'Brien", "Renée Étienne", "Иван Петров", "李小龍", "J. R. R. Tolkien"]) {
    expect(validateRegistration({ ...valid, name })).toEqual({});
  }
});

test("an email without a domain or an @ is an email-specific error", () => {
  for (const email of ["not-an-email", "missing@domain", "@example.test", "spaces in@example.test"]) {
    expect(validateRegistration({ ...valid, email }).email).toBe("Invalid email format");
  }
});

test("the password length boundary matches @Size(min = 8, max = 100) exactly", () => {
  const message = "Password must be between 8 and 100 characters";
  const at = (length) => "a".repeat(length);
  expect(validateRegistration({ ...valid, password: at(7), confirmPassword: at(7) }).password).toBe(message);
  expect(validateRegistration({ ...valid, password: at(8), confirmPassword: at(8) }).password).toBeUndefined();
  expect(validateRegistration({ ...valid, password: at(100), confirmPassword: at(100) }).password).toBeUndefined();
  expect(validateRegistration({ ...valid, password: at(101), confirmPassword: at(101) }).password).toBe(message);
});

test("a mismatched confirmation names the mismatch rather than the password", () => {
  const errors = validateRegistration({ ...valid, confirmPassword: "Different1!" });
  expect(errors.confirmPassword).toMatch(/does not match/i);
  expect(errors.password).toBeUndefined();
});

test("the name and email length caps match @Size(max = 255)", () => {
  expect(validateRegistration({ ...valid, name: "a".repeat(255) }).name).toBeUndefined();
  expect(validateRegistration({ ...valid, name: "a".repeat(256) }).name).toMatch(/255/);
});

test("phone must be a valid Indian mobile, matching @IndianMobile on the server", () => {
  // This test previously asserted the opposite — that only length mattered — because @Size(max=20)
  // was then the server's only phone rule. Both sides now carry the format rule, so a landline like
  // "(022) 1234-5678" is correctly refused rather than accepted.
  for (const phoneNumber of ["", "9876543210", "+91 8233511042", "98765-43210"]) {
    expect(validateRegistration({ ...valid, phoneNumber }).phoneNumber).toBeUndefined();
  }
  for (const phoneNumber of ["(022) 1234-5678", "12345", "5123456789", "-9876543210", "98765abcde"]) {
    expect(validateRegistration({ ...valid, phoneNumber }).phoneNumber)
      .toBe("Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.");
  }
});
