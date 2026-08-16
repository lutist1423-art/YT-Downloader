import { Navigate, useLocation } from "react-router-dom";
import { isAdminLoggedIn } from "../lib/adminAuth";

export default function RequireAdmin({ children }: { children: JSX.Element }): JSX.Element {
  const location = useLocation();
  if (!isAdminLoggedIn()) {
    return <Navigate to="/admin/login" replace state={{ from: location }} />;
  }
  return children;
}
