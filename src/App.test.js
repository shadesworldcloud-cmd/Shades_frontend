import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import StoreContextProvider from './context/StoreContext';
import App from './App';
import * as api from './services/api';

jest.mock('./services/api', () => ({
  getCurrentUser: jest.fn(),
  getStoreProducts: jest.fn(),
  // The banner asks which automatic offer is live, and the store prices the bag. Both are called on
  // mount by the shell this test renders.
  getActiveAutomaticOffer: jest.fn(),
  quoteCart: jest.fn(),
  // The hero asks for the administrator-configured banner image on mount.
  getStorefrontSettings: jest.fn(),
}));

test('renders the storefront navigation', () => {
  api.getCurrentUser.mockResolvedValue(null);
  api.getStoreProducts.mockResolvedValue({ content: [] });
  api.getActiveAutomaticOffer.mockResolvedValue({ active: false });
  api.quoteCart.mockResolvedValue(null);
  api.getStorefrontSettings.mockResolvedValue({ heroImageUrl: null });
  render(<BrowserRouter><AuthProvider><StoreContextProvider><App /></StoreContextProvider></AuthProvider></BrowserRouter>);
  expect(screen.getByText(/sign in/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute('href', '#main-content');
  expect(document.querySelector('#main-content')).toHaveAttribute('tabindex', '-1');
});
