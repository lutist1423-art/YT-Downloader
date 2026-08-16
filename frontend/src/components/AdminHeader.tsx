import { useNavigate } from "react-router-dom";
import { adminLogout } from "../lib/adminAuth";

export default function AdminHeader(): JSX.Element {
  const navigate = useNavigate();

  function handleLogout() {
    adminLogout();
    navigate("/admin/login", { replace: true });
  }

  return (
    <header className="app-header app-header--admin">
      <div className="app-header__inner">
        <span className="app-header__title">
          YT Downloader <span className="app-header__badge">Admin</span>
        </span>
        <button className="btn btn--ghost" onClick={handleLogout}>
          Log out
        </button>
      </div>
    </header>
  );
}
