import { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as api from "../services/api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Remove tokens saved by versions released before the HttpOnly-cookie migration.
    window.sessionStorage.removeItem("shades_world_session");
    let active = true;
    const restore = async () => {
      try {
        let restored;
        try {
          restored = await api.getCurrentUser();
        } catch (error) {
          if (error.status !== 401) throw error;
          await api.refreshAccessToken();
          restored = await api.getCurrentUser();
        }
        if (active) setUser(restored);
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    restore();
    return () => { active = false; };
  }, []);

  const loadUser = async () => {
    const current = await api.getCurrentUser();
    setUser(current);
    return current;
  };

  const signIn = async (email, password) => {
    await api.login(email.trim().toLowerCase(), password);
    return loadUser();
  };

  const register = async (customer) => {
    return api.register({
      ...customer,
      name: customer.name.trim(),
      email: customer.email.trim().toLowerCase(),
      phoneNumber: customer.phoneNumber?.trim(),
    });
  };

  const signInWithGoogle = useCallback(async (credential) => {
    await api.googleLogin(credential);
    const current = await api.getCurrentUser();
    setUser(current);
    return current;
  }, []);

  /**
   * Never rejects. Local sign-out is the part we fully control, so it always happens; a failed
   * server call must not leave the user staring at an error while still appearing signed in.
   *
   * This matters because sign-out is not always user-initiated — AdminExitGuard calls it on
   * navigation, including browser Back — so a rejection here became an unhandled rejection and a
   * dev-overlay error screen rather than anything the user could act on.
   *
   * The reason is returned rather than swallowed silently, so a caller can surface a genuine
   * backend failure while the session is still correctly cleared.
   */
  const signOut = async () => {
    let failure = null;
    try {
      await api.logout();
    } catch (error) {
      failure = error;
      if (process.env.NODE_ENV !== "test") {
        console.warn("Sign-out request failed; clearing the local session anyway.", error);
      }
    } finally {
      setUser(null);
    }
    return failure;
  };

  const value = {
    user,
    accessToken: user ? "cookie-session" : null,
    loading,
    isAuthenticated: Boolean(user),
    isAdmin: user?.roles?.includes("ADMIN") || false,
    signIn,
    register,
    signInWithGoogle,
    updateUser: setUser,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
};
