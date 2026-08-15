import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Footer from "./Footer";

test("footer exposes real internal information links without placeholder anchors", () => {
  const { container } = render(<MemoryRouter><Footer /></MemoryRouter>);
  expect(screen.getByRole("link", { name: /shipping & delivery/i })).toHaveAttribute("href", "/info/shipping");
  expect(screen.getByRole("link", { name: /returns & refunds/i })).toHaveAttribute("href", "/info/returns");
  expect(screen.getByRole("link", { name: /privacy policy/i })).toHaveAttribute("href", "/info/privacy");
  expect(container.querySelector('a[href="#"]')).not.toBeInTheDocument();
});
