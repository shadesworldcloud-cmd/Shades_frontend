import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getUnreadNotificationCount } from "../../services/api";
import "./NotificationBell.css";

export default function NotificationBell() {
  const { accessToken, user } = useAuth();
  const [count, setCount] = useState(0);
  const load = useCallback(async () => {
    if (!accessToken) return setCount(0);
    try { const result = await getUnreadNotificationCount(accessToken); setCount(result.unreadCount || 0); }
    catch { setCount(0); }
  }, [accessToken]);
  useEffect(() => {
    load(); const timer = window.setInterval(load, 30000); const refresh = () => load();
    window.addEventListener("notifications:changed", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("notifications:changed", refresh); };
  }, [load]);
  if (!user) return null;
  return <Link className="notification-bell" to="/notifications" aria-label={`${count} unread notifications`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>{count > 0 && <span>{count > 99 ? "99+" : count}</span>}</Link>;
}
