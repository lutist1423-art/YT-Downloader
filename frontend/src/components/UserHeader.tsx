import { useNavigate } from "react-router-dom";
import { logout } from "../lib/userAuth";

export default function UserHeader(): JSX.Element {
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="app-header app-header--user">
      <div className="app-header__inner">
        <span className="app-header__title">YT Downloader</span>
        <button className="btn btn--ghost" onClick={handleLogout}>
          Log out
        </button>
      </div>
    </header>
  );
}
