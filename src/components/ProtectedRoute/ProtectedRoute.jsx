import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const ProtectedRoute = ({ children, adminOnly = false, customerOnly = false }) => {
  const { isAuthenticated, isAdmin, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="route-loading">Preparing your account...</div>;
  if (!isAuthenticated) return <Navigate to="/signin" replace state={{ from: location }} />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  if (customerOnly && isAdmin) return <Navigate to="/admin" replace />;
  return children;
};

export default ProtectedRoute;
