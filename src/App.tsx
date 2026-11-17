import { useEffect, useState } from "react";
import { Game } from "./components/Game";
import { Login } from "./components/Login";
import { clearToken, getToken, verifyToken, type Identity } from "./lib/auth";

const ID_KEY = "dbt:identity";

export function App() {
  const [identity, setIdentity] = useState<Identity | null>(() => {
    try {
      return getToken() ? (JSON.parse(localStorage.getItem(ID_KEY) ?? "null") as Identity | null) : null;
    } catch {
      return null;
    }
  });

  // Re-validate a stored token in the background; log out if Discogs revoked it.
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    verifyToken(token)
      .then((id) => {
        localStorage.setItem(ID_KEY, JSON.stringify(id));
        setIdentity(id);
      })
      .catch((e: Error) => {
        if (/rejected/.test(e.message)) logout();
      });
  }, []);

  const login = (id: Identity) => {
    localStorage.setItem(ID_KEY, JSON.stringify(id));
    setIdentity(id);
  };

  const logout = () => {
    clearToken();
    localStorage.removeItem(ID_KEY);
    setIdentity(null);
  };

  return identity ? <Game identity={identity} onLogout={logout} /> : <Login onLogin={login} />;
}
