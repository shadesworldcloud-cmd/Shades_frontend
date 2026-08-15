import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import StoreInfo from "./StoreInfo";

const cases = [
  ["about", "About Shades World Barcelona"],
  ["contact", "Contact us"],
  ["shipping", "Shipping & delivery"],
  ["returns", "Returns & refunds"],
  ["faq", "Frequently asked questions"],
  ["size-guide", "Eyewear size guide"],
  ["privacy", "Privacy policy"],
  ["terms", "Terms & conditions"],
];

test.each(cases)("renders the %s information page", (page, heading) => {
  render(<MemoryRouter initialEntries={[`/info/${page}`]}><Routes>
    <Route path="/info/:page" element={<StoreInfo />} />
  </Routes></MemoryRouter>);
  expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  expect(screen.getByRole("complementary", { name: /store information/i })).toBeInTheDocument();
});

test("shows an intentional not-found state for an unknown information route", () => {
  render(<MemoryRouter initialEntries={["/info/missing"]}><Routes>
    <Route path="/info/:page" element={<StoreInfo />} />
  </Routes></MemoryRouter>);
  expect(screen.getByRole("heading", { name: /page not found/i })).toBeInTheDocument();
});
