import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MyOrders from "./MyOrders";
import * as api from "../../services/api";

jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ accessToken: "cookie-session", user: { name: "Ada Lovelace" } }) }));
jest.mock("../../services/api", () => ({ getMyOrders: jest.fn(), getMyReturns: jest.fn(),
  cancelOrder: jest.fn(), cancelReturn: jest.fn(), createReturn: jest.fn(), downloadInvoice: jest.fn() }));

const order = (overrides = {}) => ({
  orderId: 41, orderStatus: "PLACED", purchasedAt: "2026-08-01T10:00:00", totalAmount: 3998,
  subtotalAmount: 3998, discountAmount: 0, shippingAmount: 0, taxAmount: 0,
  items: [{ orderItemId: 5, productName: "OBA", sku: "SKU1", quantity: 2, lineTotal: 3998 }],
  payments: [], shipments: [],
  shippingAddress: { name: "Ada", line1: "1 Test St", city: "Bengaluru", state: "KA", pincode: "560001", country: "India" },
  ...overrides,
});

const view = async () => {
  const utils = render(<MemoryRouter><MyOrders /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("#41")).toBeInTheDocument());
  return utils;
};
const openDialog = async () => {
  const trigger = screen.getByRole("button", { name: "Cancel order" });
  // A real browser focuses a button when it is clicked; jsdom does not, and the dialog restores
  // focus to whatever was focused on open, so focus it explicitly to model the real interaction.
  trigger.focus();
  fireEvent.click(trigger);
  return screen.getByRole("dialog");
};

beforeEach(() => {
  jest.clearAllMocks();
  api.getMyOrders.mockResolvedValue({ content: [order()] });
  api.getMyReturns.mockResolvedValue({ content: [] });
  api.cancelOrder.mockResolvedValue({});
});

test("clicking Cancel order does not cancel anything before confirmation", async () => {
  await view();
  await openDialog();
  expect(api.cancelOrder).not.toHaveBeenCalled();
});

test("the dialog states the consequence and offers Confirm and Keep Order", async () => {
  await view();
  const dialog = await openDialog();
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog).toHaveAccessibleName("Cancel order #41?");
  expect(dialog).toHaveTextContent(/cannot be undone/i);
  expect(dialog).toHaveTextContent(/returned to stock/i);
  expect(screen.getByRole("button", { name: "Keep order" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancel the order" })).toBeInTheDocument();
});

test("focus lands on the non-destructive control, so a stray Enter cannot cancel the order", async () => {
  await view();
  await openDialog();
  expect(screen.getByRole("button", { name: "Keep order" })).toHaveFocus();
});

test("Keep order closes the dialog, preserves the order and restores focus", async () => {
  await view();
  await openDialog();
  fireEvent.click(screen.getByRole("button", { name: "Keep order" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.cancelOrder).not.toHaveBeenCalled();
  // Awaited, because restoring focus is deliberately deferred by a task. Closing via a button
  // inside the dialog destroys the focused element, and the browser's own reset of focus to
  // <body> lands after the effect cleanup — a synchronous restore was silently undone by it.
  // The assertion is the same; only the timing it tolerates has changed.
  await waitFor(() => expect(screen.getByRole("button", { name: "Cancel order" })).toHaveFocus());
});

test("Escape closes the dialog without cancelling", async () => {
  await view();
  await openDialog();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.cancelOrder).not.toHaveBeenCalled();
});

test("confirming cancels exactly once even when the control is clicked repeatedly", async () => {
  let release;
  api.cancelOrder.mockReturnValue(new Promise((resolve) => { release = resolve; }));
  await view();
  await openDialog();
  const confirm = screen.getByRole("button", { name: "Cancel the order" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(api.cancelOrder).toHaveBeenCalledTimes(1);
  release({});
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("progress is shown and dismissal is blocked while the request is in flight", async () => {
  let release;
  api.cancelOrder.mockReturnValue(new Promise((resolve) => { release = resolve; }));
  await view();
  await openDialog();
  fireEvent.click(screen.getByRole("button", { name: "Cancel the order" }));

  expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Keep order" })).toBeDisabled();
  // Escaping mid-flight would leave the shopper unsure whether the cancel landed.
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  release({});
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("an API failure keeps the dialog open, reports the reason and leaves the order untouched", async () => {
  api.cancelOrder.mockRejectedValue(new Error("Order can no longer be cancelled"));
  await view();
  await openDialog();
  fireEvent.click(screen.getByRole("button", { name: "Cancel the order" }));

  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Order can no longer be cancelled"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  // The list is only reloaded on success, so the order still shows as cancellable.
  expect(api.getMyOrders).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Cancel the order" })).not.toBeDisabled();
});

test("the order list is refreshed only after a successful cancellation", async () => {
  api.getMyOrders
    .mockResolvedValueOnce({ content: [order()] })
    .mockResolvedValueOnce({ content: [order({ orderStatus: "CANCELLED" })] });
  await view();
  await openDialog();
  fireEvent.click(screen.getByRole("button", { name: "Cancel the order" }));

  await waitFor(() => expect(screen.getByText(/Order #41 was cancelled/)).toBeInTheDocument());
  expect(api.getMyOrders).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("button", { name: "Cancel order" })).not.toBeInTheDocument();
});

test("a paid order warns about the refund before confirming", async () => {
  api.getMyOrders.mockResolvedValue({ content: [order({ payments: [{ status: "PAID" }] })] });
  await view();
  const dialog = await openDialog();
  expect(dialog).toHaveTextContent(/recorded for refund/i);
});
