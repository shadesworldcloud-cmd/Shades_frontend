const { test, expect } = require("@playwright/test");
const { admin } = require("./support/fixtures");
const { submitSignIn } = require("./support/ui");

// One-off measurement probe for the wizard's visual pass — prints computed styles so the design
// change is verified with numbers. Not part of the regular suite's assertions beyond sanity.
test("measure the wizard's computed styles", async ({ page }) => {
  const account = await admin();
  await submitSignIn(page, account, { admin: true });
  await page.getByRole("button", { name: /^Products$/ }).click();
  await page.getByRole("button", { name: "+ Add product" }).click();
  await expect(page.getByLabel(/Product name/)).toBeVisible();

  const styles = await page.evaluate(() => {
    const pick = (selector, properties) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const computed = getComputedStyle(element);
      return Object.fromEntries(properties.map((property) => [property, computed[property]]));
    };
    return {
      currentStep: pick(".pw-steps .current button", ["borderRadius", "borderColor", "boxShadow", "fontWeight"]),
      stepNumber: pick(".pw-steps .current .pw-step-number", ["backgroundColor", "color", "borderRadius", "width"]),
      hint: pick(".pw-hint", ["borderLeftWidth", "borderLeftColor", "backgroundColor", "padding"]),
      variantHeader: pick(".pw-variant .draft-variant-head", ["backgroundColor", "borderBottomWidth", "margin"]),
      photoBox: pick(".pw-photos", ["borderStyle", "borderRadius", "backgroundColor"]),
      fileButton: pick('.pw-photos input[type="file"]', ["fontSize", "borderColor"]),
      actions: pick(".pw .modal-actions", ["position", "bottom", "boxShadow"]),
    };
  });
  console.log("WIZARD_STYLES " + JSON.stringify(styles, null, 1));

  // The invalid state is visible on the field itself, not only in the caption.
  await page.getByRole("button", { name: "Continue" }).click();
  const invalid = await page.evaluate(() => {
    const element = document.getElementById("pw-productName");
    const computed = getComputedStyle(element);
    return { ariaInvalid: element.getAttribute("aria-invalid"), borderColor: computed.borderColor, boxShadow: computed.boxShadow };
  });
  console.log("INVALID_FIELD " + JSON.stringify(invalid));
  expect(invalid.ariaInvalid).toBe("true");
  expect(invalid.borderColor).not.toBe("rgb(216, 214, 207)"); // the default #d8d6cf must be overridden
});
