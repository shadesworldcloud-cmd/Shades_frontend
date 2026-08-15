import { render, screen, waitFor } from "@testing-library/react";
import PromoBar from "./PromoBar";
import * as api from "../../services/api";

jest.mock("../../services/api", () => ({ getActiveAutomaticOffer: jest.fn() }));

// A pattern, not the component's exported FALLBACK_MESSAGE constant. That constant contains the
// double spaces that space the separator dot, and testing-library normalizes whitespace before
// comparing — so matching on it fails to find text that is actually there, and (worse) a
// queryByText(...) absence check against it passes whether the message was rendered or not.
const FALLBACK_PATTERN = /Free shipping on orders of ₹500 or more/;

/**
 * The banner's two states and the one property that has to hold in both: no dismissal is ever
 * persisted anywhere.
 *
 * The E2E suite proves this against the real backend and a real reload; these tests pin the
 * component's own contract cheaply, including the failure path — a lookup that rejects must leave the
 * standing message rather than an empty strip, because an empty strip moves the whole page.
 */
describe("PromoBar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  test("shows the offer message and renders no dismissal control while an offer is live", async () => {
    api.getActiveAutomaticOffer.mockResolvedValue({
      active: true, offerName: "Weekend pair offer",
      bannerMessage: "Buy any 2 eligible products and get ₹500 off automatically for every complete pair.",
    });

    render(<PromoBar />);

    expect(await screen.findByText(/Buy any 2 eligible products/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
    expect(screen.queryByText(FALLBACK_PATTERN)).not.toBeInTheDocument();
  });

  test("falls back to the standing shipping message when no offer is live", async () => {
    api.getActiveAutomaticOffer.mockResolvedValue({ active: false });

    render(<PromoBar />);

    expect(await screen.findByText(FALLBACK_PATTERN)).toBeInTheDocument();
    // The existing close control stays in the fallback state — that is the design that shipped, and
    // the non-dismissible requirement is about the offer banner.
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  test("a failed lookup keeps the standing message rather than collapsing the strip", async () => {
    api.getActiveAutomaticOffer.mockRejectedValue(new Error("network down"));

    render(<PromoBar />);

    expect(await screen.findByText(FALLBACK_PATTERN)).toBeInTheDocument();
  });

  test("nothing about the banner is written to localStorage, sessionStorage or a cookie", async () => {
    api.getActiveAutomaticOffer.mockResolvedValue({
      active: true, offerName: "Weekend pair offer", bannerMessage: "Two for ₹500",
    });

    render(<PromoBar />);
    await screen.findByText("Two for ₹500");

    expect(JSON.stringify(window.localStorage)).not.toMatch(/promo|banner|dismiss/i);
    expect(JSON.stringify(window.sessionStorage)).not.toMatch(/promo|banner|dismiss/i);
    expect(document.cookie).not.toMatch(/promo|banner|dismiss/i);
  });

  test("the message is a text node, so administrator markup can never become elements", async () => {
    api.getActiveAutomaticOffer.mockResolvedValue({
      active: true, offerName: "Injection probe",
      bannerMessage: "<img src=x onerror=alert(1)><b>Two for ₹500</b>",
    });

    const { container } = render(<PromoBar />);
    await screen.findByText(/Two for ₹500/);

    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll("b")).toHaveLength(0);
    // The characters are present as text, which is exactly the point: displayed, never parsed.
    expect(container.textContent).toContain("<b>Two for ₹500</b>");
  });

  test("re-reads the offer when the tab regains focus, so an edited message reaches the customer", async () => {
    api.getActiveAutomaticOffer
      .mockResolvedValueOnce({ active: true, offerName: "One", bannerMessage: "First wording" })
      .mockResolvedValueOnce({ active: true, offerName: "One", bannerMessage: "Second wording" });

    render(<PromoBar />);
    expect(await screen.findByText("First wording")).toBeInTheDocument();

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(screen.getByText("Second wording")).toBeInTheDocument());
  });
});
