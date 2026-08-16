import { Navigate, useLocation } from "react-router-dom";
import { isLoggedIn } from "../lib/userAuth";

export default function RequireUser({ children }: { children: JSX.Element }): JSX.Element {
  const location = useLocation();
  if (!isLoggedIn()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}
