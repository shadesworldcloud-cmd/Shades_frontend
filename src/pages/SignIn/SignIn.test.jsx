import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SignIn from "./SignIn";

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    signIn: jest.fn(), register: jest.fn(), signInWithGoogle: jest.fn(),
    isAuthenticated: true, isAdmin: false,
  }),
}));

test("an authenticated customer can open a password-reset email link", () => {
  render(<MemoryRouter initialEntries={["/signin?resetToken=one-time-token"]}><SignIn /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
  expect(screen.getByLabelText("New password")).toBeInTheDocument();
  expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
});
