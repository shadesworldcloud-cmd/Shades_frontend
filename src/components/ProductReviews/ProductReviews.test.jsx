import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ProductReviews from "./ProductReviews";
import * as api from "../../services/api";

const auth = { accessToken: "cookie-session", isAuthenticated: true, isAdmin: false };
jest.mock("../../context/AuthContext", () => ({ useAuth: () => auth }));
jest.mock("../../services/api", () => ({
  getProductReviews: jest.fn(), getMyProductReview: jest.fn(), getReviewableVariants: jest.fn(),
  createReview: jest.fn(), updateReview: jest.fn(), deleteReview: jest.fn(),
}));

const approved = {
  reviewId: 1, productId: 20, orderItemId: 5, variantId: 22, variantName: "Ocean Blue", variantSku: "SKU1",
  customerName: "Ada Lovelace", rating: 4, reviewText: "Sharp and light.", reviewStatus: "APPROVED",
  createdAt: "2026-08-01T10:00:00", updatedAt: "2026-08-01T10:00:00",
};
const eligible = { orderItemId: 5, variantId: 22, variantName: "Ocean Blue", sku: "SKU1", productName: "OBA", quantity: 1 };

const awaitForm = async () => waitFor(() => expect(screen.getByRole('button', { name: /variant review$/ })).toBeInTheDocument());
const view = async () => {
  const utils = render(<MemoryRouter><ProductReviews productId="20" /></MemoryRouter>);
  await waitFor(() => expect(api.getProductReviews).toHaveBeenCalled());
  return utils;
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(auth, { accessToken: "cookie-session", isAuthenticated: true, isAdmin: false });
  api.getProductReviews.mockResolvedValue({ content: [] });
  api.getMyProductReview.mockResolvedValue([]);
  api.getReviewableVariants.mockResolvedValue([]);
});

test("shows the rating summary from approved reviews", async () => {
  api.getProductReviews.mockResolvedValue({ content: [approved, { ...approved, reviewId: 2, rating: 2 }] });
  await view();
  await waitFor(() => expect(screen.getByText("3.0")).toBeInTheDocument());
  expect(screen.getByText("2 verified reviews")).toBeInTheDocument();
});

test("a signed-out visitor is invited to sign in rather than shown a dead form", async () => {
  Object.assign(auth, { accessToken: null, isAuthenticated: false });
  await view();
  expect(screen.getByText("Purchased this frame?")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Publish variant review/ })).not.toBeInTheDocument();
  // The unauthenticated load must not call the endpoints that require a session.
  expect(api.getMyProductReview).not.toHaveBeenCalled();
  expect(api.getReviewableVariants).not.toHaveBeenCalled();
});

test("no form is offered without a delivered purchase", async () => {
  await view();
  expect(screen.queryByRole("button", { name: /Publish variant review/ })).not.toBeInTheDocument();
});

test("a delivered purchase can be reviewed, and the list refreshes afterwards", async () => {
  api.getReviewableVariants.mockResolvedValue([eligible]);
  api.createReview.mockResolvedValue({ ...approved, reviewStatus: "PENDING" });
  await view();
  await awaitForm();

  fireEvent.click(screen.getByRole("button", { name: "4 stars" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Lovely blue." } });
  fireEvent.click(screen.getByRole("button", { name: "Publish variant review" }));

  await waitFor(() => expect(api.createReview).toHaveBeenCalledWith("cookie-session", {
    productId: 20, orderItemId: 5, rating: 4, reviewText: "Lovely blue.",
  }));
  // Success feedback says it is live, and the list is reloaded so it appears straight away.
  await waitFor(() => expect(screen.getByText(/is now live/)).toBeInTheDocument());
  expect(api.getProductReviews).toHaveBeenCalledTimes(2);
});

test("a rejected submission is reported and nothing is silently swallowed", async () => {
  api.getReviewableVariants.mockResolvedValue([eligible]);
  api.createReview.mockRejectedValue(new Error("You have already reviewed this purchased variant"));
  await view();
  await awaitForm();

  fireEvent.click(screen.getByRole("button", { name: "Publish variant review" }));
  await waitFor(() => expect(screen.getByRole("alert"))
    .toHaveTextContent("You have already reviewed this purchased variant"));
});

test("a second variant of the same product is reviewable — the case the DB constraint used to block", async () => {
  // The live schema carried UQ_USER_PRODUCT_REVIEW (USER_ID, PRODUCT_ID), so reviewing a second
  // variant of one product violated it even though the code keys reviews per order item.
  const second = { ...eligible, orderItemId: 6, variantId: 23, variantName: "Orange", sku: "SKU2" };
  api.getMyProductReview.mockResolvedValue([{ ...approved, reviewStatus: "APPROVED" }]);
  api.getReviewableVariants.mockResolvedValue([second]);
  api.createReview.mockResolvedValue({ ...approved, reviewId: 9, orderItemId: 6, reviewStatus: "PENDING" });
  await view();
  await awaitForm();

  fireEvent.click(screen.getByRole("button", { name: "Publish variant review" }));
  await waitFor(() => expect(api.createReview).toHaveBeenCalledWith("cookie-session",
    expect.objectContaining({ productId: 20, orderItemId: 6 })));
});

test("moderation state is explained rather than left looking published", async () => {
  api.getMyProductReview.mockResolvedValue([{ ...approved, reviewStatus: "PENDING" }]);
  await view();
  await waitFor(() => expect(screen.getByText(/re-checked after moderation/)).toBeInTheDocument());
});

test("a rejected review can be edited and resubmitted", async () => {
  api.getMyProductReview.mockResolvedValue([{ ...approved, reviewStatus: "REJECTED" }]);
  api.updateReview.mockResolvedValue({ ...approved, reviewStatus: "PENDING" });
  await view();

  await waitFor(() => expect(screen.getByText(/removed by moderation/)).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Edit review" }));
  fireEvent.click(screen.getByRole("button", { name: "Update variant review" }));
  await waitFor(() => expect(api.updateReview).toHaveBeenCalledWith("cookie-session", 1,
    { rating: 4, reviewText: "Sharp and light." }));
});

test("deleting asks for confirmation first and does not delete on dismissal", async () => {
  api.getMyProductReview.mockResolvedValue([approved]);
  await view();
  await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog).toHaveTextContent("Ocean Blue");
  expect(api.deleteReview).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Keep review" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.deleteReview).not.toHaveBeenCalled();
});

test("confirming the delete removes it once and reloads", async () => {
  api.getMyProductReview.mockResolvedValue([approved]);
  api.deleteReview.mockResolvedValue({});
  await view();
  await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  const confirm = screen.getByRole("button", { name: "Delete review" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(api.deleteReview).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByText("Your review was deleted.")).toBeInTheDocument());
});

test("review text is rendered as text, never as markup", async () => {
  const nasty = { ...approved, reviewText: '<img src=x onerror="alert(1)">bad' };
  api.getProductReviews.mockResolvedValue({ content: [nasty] });
  const { container } = await view();
  await waitFor(() => expect(screen.getByText(/bad/)).toBeInTheDocument());
  expect(container.querySelector("img[onerror]")).toBeNull();
  expect(container.querySelector(".reviews-list").innerHTML).toContain("&lt;img");
});

test("an administrator is told they cannot publish customer reviews", async () => {
  Object.assign(auth, { isAdmin: true });
  await view();
  expect(screen.getByText(/Administrator accounts cannot publish customer reviews/)).toBeInTheDocument();
});

test("a newly published review is visible to everyone straight away, with no approval step", async () => {
  // The public list is the server's own PUBLISHED/APPROVED set; the component must not add a
  // second, stricter filter of its own on top of it.
  const published = { ...approved, reviewStatus: "PUBLISHED", reviewText: "Live immediately." };
  api.getProductReviews.mockResolvedValue({ content: [published] });
  auth.isAuthenticated = false;
  auth.accessToken = null;
  await view();
  // Signed out — a guest sees it.
  await waitFor(() => expect(screen.getByText("Live immediately.")).toBeInTheDocument());
  expect(screen.getByText("4.0")).toBeInTheDocument();
  expect(screen.getByText("1 verified review")).toBeInTheDocument();
});

test("the rating summary counts published reviews", async () => {
  api.getProductReviews.mockResolvedValue({ content: [
    { ...approved, reviewId: 1, reviewStatus: "PUBLISHED", rating: 5 },
    { ...approved, reviewId: 2, reviewStatus: "APPROVED", rating: 3 },
  ] });
  await view();
  await waitFor(() => expect(screen.getByText("4.0")).toBeInTheDocument());
  expect(screen.getByText("2 verified reviews")).toBeInTheDocument();
});
