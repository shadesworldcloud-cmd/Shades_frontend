import { fireEvent, render, screen } from "@testing-library/react";
import CommunicationPreferences from "./CommunicationPreferences";

const value = { emailOrderUpdates:true, emailShipmentUpdates:false, emailReturnRefundUpdates:true,
  inAppOrderUpdates:true, inAppShipmentUpdates:true, inAppReturnRefundUpdates:true, inAppReviewUpdates:false };

test("shows every preference and preserves mandatory security communication", () => {
  const onChange = jest.fn(() => jest.fn()); const onSave = jest.fn((event) => event.preventDefault());
  render(<CommunicationPreferences value={value} loading={false} saving={false} onChange={onChange} onSave={onSave} />);
  expect(screen.getByText(/Password resets, email verification and important security messages are always sent/i)).toBeInTheDocument();
  expect(screen.getAllByRole("checkbox")).toHaveLength(7);
  expect(screen.getByRole("checkbox", { name: /Courier, tracking and delivery-status changes/i })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: /Save communication preferences/i }));
  expect(onSave).toHaveBeenCalledTimes(1);
});
