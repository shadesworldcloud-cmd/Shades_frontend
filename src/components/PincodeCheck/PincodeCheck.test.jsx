import { fireEvent, render, screen } from "@testing-library/react";
import PincodeCheck from "./PincodeCheck";
import * as api from "../../services/api";
import { clearDeliveryEstimateCache } from "../../services/deliveryEstimate";

jest.mock("../../services/api", () => ({ getDeliveryEstimate: jest.fn() }));

const check = (pincode) => {
  fireEvent.change(screen.getByLabelText("Delivery pincode"), { target: { value: pincode } });
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
};

beforeEach(() => {
  jest.clearAllMocks();
  clearDeliveryEstimateCache();
  window.sessionStorage.clear();
});

test("shows Shiprocket's expected delivery dates and courier", async () => {
  api.getDeliveryEstimate.mockResolvedValue({ pincode: "560001", serviceable: true, earliestDate: "2026-11-14",
    latestDate: "2026-11-17", courierName: "Xpressbees", courierCount: 3, source: "SHIPROCKET" });
  render(<PincodeCheck />);
  check("560001");

  const result = await screen.findByTestId("pincode-check-result");
  expect(result).toHaveTextContent("Delivery available to 560001");
  expect(result).toHaveTextContent(/Expected delivery: Sat.*14.*Nov – Tue.*17.*Nov/);
  expect(result).toHaveTextContent("via Xpressbees (+2 more options)");
  expect(api.getDeliveryEstimate).toHaveBeenCalledWith("560001");
  expect(window.sessionStorage.getItem("sw:delivery-pincode")).toBe("560001");
});

test("says so when the pincode cannot be delivered to", async () => {
  api.getDeliveryEstimate.mockResolvedValue({ pincode: "194101", serviceable: false, source: "SHIPROCKET" });
  render(<PincodeCheck />);
  check("194101");
  expect(await screen.findByRole("alert")).toHaveTextContent("we don't deliver to 194101 yet");
  expect(screen.queryByTestId("pincode-check-result")).not.toBeInTheDocument();
});

test("falls back to the standard window when Shiprocket cannot be reached", async () => {
  api.getDeliveryEstimate.mockRejectedValue(new Error("offline"));
  render(<PincodeCheck />);
  check("560001");
  const result = await screen.findByTestId("pincode-check-result");
  expect(result).toHaveTextContent("Usually delivered:");
  expect(result).toHaveTextContent("standard delivery is 3–5 business days after dispatch");
});

test("rejects an invalid pincode without calling the server", () => {
  render(<PincodeCheck />);
  check("1234");
  expect(screen.getByRole("alert")).toHaveTextContent("valid 6-digit pincode");
  expect(api.getDeliveryEstimate).not.toHaveBeenCalled();
});

test("re-checks a pincode remembered earlier in the session", async () => {
  window.sessionStorage.setItem("sw:delivery-pincode", "110001");
  api.getDeliveryEstimate.mockResolvedValue({ pincode: "110001", serviceable: true, earliestDate: "2026-11-13",
    latestDate: "2026-11-13", courierName: "Delhivery", courierCount: 1, source: "SHIPROCKET" });
  render(<PincodeCheck />);
  expect(await screen.findByTestId("pincode-check-result")).toHaveTextContent(/Expected delivery: Fri.*13.*Nov.*via Delhivery/);
  expect(screen.getByLabelText("Delivery pincode")).toHaveValue("110001");
});
