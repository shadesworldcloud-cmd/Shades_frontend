import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MyOrders from "./MyOrders";
import * as api from "../../services/api";

jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ accessToken: "cookie-session", user: { name: "Ada" } }) }));
jest.mock("../../services/api", () => ({ getMyOrders: jest.fn(), getMyReturns: jest.fn(),
  cancelOrder: jest.fn(), cancelReturn: jest.fn(), createReturn: jest.fn(), downloadInvoice: jest.fn() }));

const order = (shipment, overrides = {}) => ({
  orderId: 41, orderStatus: "SHIPPED", purchasedAt: "2026-11-10T10:00:00", totalAmount: 3998,
  subtotalAmount: 3998, discountAmount: 0, shippingAmount: 0, taxAmount: 0,
  items: [{ orderItemId: 5, productName: "OBA", sku: "SKU1", quantity: 1, lineTotal: 3998 }],
  payments: [], shipments: shipment ? [shipment] : [],
  shippingAddress: { name: "Ada", line1: "1 Test St", city: "Bengaluru", state: "KA", pincode: "560001", country: "India" },
  ...overrides,
});
const shiprocketShipment = { shipmentId: 3, provider: "Delhivery", courierName: "Delhivery", awbCode: "AWB123",
  status: "SHIPPED", shippedAt: "2026-11-11T12:00:00", expectedDeliveryAt: "2026-11-16T20:00:00" };

const view = async () => {
  render(<MemoryRouter><MyOrders /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("#41")).toBeInTheDocument());
};

beforeEach(() => {
  jest.clearAllMocks();
  api.getMyReturns.mockResolvedValue({ content: [] });
});

test("an in-transit order shows the courier's expected delivery date", async () => {
  api.getMyOrders.mockResolvedValue({ content: [order(shiprocketShipment)] });
  await view();
  expect(screen.getByText("Expected delivery")).toBeInTheDocument();
  expect(screen.getByText("16 November 2026")).toBeInTheDocument();
  expect(screen.getByText(/Delhivery · AWB123/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View order details" }));
  expect(screen.getByText(/Expected by 16 November 2026/)).toBeInTheDocument();
});

test("a delivered order shows when it was delivered instead of the estimate", async () => {
  api.getMyOrders.mockResolvedValue({ content: [order({ ...shiprocketShipment, status: "DELIVERED", deliveredAt: "2026-11-15T14:00:00" }, { orderStatus: "DELIVERED" })] });
  await view();
  expect(screen.getAllByText("Delivered").length).toBeGreaterThan(0);
  expect(screen.getByText("15 November 2026")).toBeInTheDocument();
  expect(screen.queryByText("Expected delivery")).not.toBeInTheDocument();
});

test("an order without a shipment says the estimate is pending", async () => {
  api.getMyOrders.mockResolvedValue({ content: [order(null, { orderStatus: "CONFIRMED" })] });
  await view();
  fireEvent.click(screen.getByRole("button", { name: "View order details" }));
  expect(screen.getByText(/Delivery estimate pending/)).toBeInTheDocument();
});
