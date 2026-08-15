import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "../../services/api";
import "./Notifications.css";

const relativeTime = (value) => { const seconds=Math.max(1,Math.floor((Date.now()-new Date(value).getTime())/1000));if(seconds<60)return"Just now";if(seconds<3600)return`${Math.floor(seconds/60)}m ago`;if(seconds<86400)return`${Math.floor(seconds/3600)}h ago`;return new Date(value).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}); };

export default function Notifications({ embedded=false, onAdminNavigate }) {
  const { accessToken, isAdmin }=useAuth(); const navigate=useNavigate(); const [items,setItems]=useState([]); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
  const load=useCallback(async()=>{setLoading(true);setError("");try{const page=await getNotifications(accessToken);setItems(page.content||[])}catch(err){setError(err.message)}finally{setLoading(false)}},[accessToken]);
  useEffect(()=>{load()},[load]);
  const destination=(item)=>{if(!isAdmin)return item.actionUrl;const text=`${item.subject} ${item.message}`.toLowerCase();if(text.includes("return")||text.includes("refund"))return"returns";if(text.includes("order"))return"orders";return"overview"};
  const open=async(item)=>{if(!item.read){try{const updated=await markNotificationRead(accessToken,item.notificationId);setItems((current)=>current.map((entry)=>entry.notificationId===updated.notificationId?updated:entry));window.dispatchEvent(new Event("notifications:changed"))}catch(err){return setError(err.message)}}const target=destination(item);if(isAdmin&&embedded)onAdminNavigate?.(target);else if(target)navigate(target)};
  const markAll=async()=>{try{await markAllNotificationsRead(accessToken);setItems((current)=>current.map((item)=>({...item,read:true,readAt:item.readAt||new Date().toISOString()})));window.dispatchEvent(new Event("notifications:changed"))}catch(err){setError(err.message)}};
  const unread=items.filter((item)=>!item.read).length;
  const content=<section className={`notification-centre ${embedded?"embedded":""}`}><header><div><span>{isAdmin?"Operations":"Your account"}</span><h1>Notification centre</h1><p>Order, delivery, return and refund updates in one place.</p></div><div><button onClick={load}>Refresh</button><button disabled={!unread} onClick={markAll}>Mark all read</button></div></header>{error&&<div className="notification-error">{error}</div>}<div className="notification-summary"><strong>{unread}</strong><span>unread</span><i></i><span>{items.length} recent notifications</span></div>{loading?<div className="notification-empty">Loading notifications…</div>:items.length===0?<div className="notification-empty"><span>✓</span><h2>You're all caught up</h2><p>New activity will appear here.</p></div>:<div className="notification-list">{items.map((item)=><button key={item.notificationId} className={item.read?"read":"unread"} onClick={()=>open(item)}><i></i><div><strong>{item.subject}</strong><p>{item.message}</p><small>{relativeTime(item.createdAt)}</small></div><b>{item.read?"":"New"}</b><em>→</em></button>)}</div>}</section>;
  return embedded?content:<main className="notifications-page"><div className="container">{content}</div></main>;
}
