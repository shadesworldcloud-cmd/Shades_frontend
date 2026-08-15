import { useCallback, useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { StoreContext } from "../../context/StoreContext";
import { useAuth } from "../../context/AuthContext";
// forgotPassword is no longer imported here: the Account security section was the only caller on
// this page. The API itself is untouched and still drives the real reset flow from SignIn.
import { createAddress, deleteAddress, getAddresses, getMyOrders, setDefaultAddress, updateAddress, updateCurrentUser, getCommunicationPreferences, updateCommunicationPreferences } from "../../services/api";
import { pincodeError, sanitisePincode } from "../../services/pincode";
import { phoneError } from "../../services/phone";
import "./Account.css";
import "./CommunicationPreferences.css";
import CommunicationPreferences from "./CommunicationPreferences";
import useConfirmAction from "../../hooks/useConfirmAction";

const blankAddress = { addressType:"SHIPPING", recipientName:"", phoneNumber:"", houseNumber:"", addressLine1:"", addressLine2:"", city:"", state:"", pincode:"", country:"India", isDefault:false };
const defaultPreferences = { emailOrderUpdates:true, emailShipmentUpdates:true, emailReturnRefundUpdates:true, inAppOrderUpdates:true, inAppShipmentUpdates:true, inAppReturnRefundUpdates:true, inAppReviewUpdates:true };
const formatDate = (value) => value ? new Date(value).toLocaleDateString("en-IN", { day:"numeric", month:"long", year:"numeric" }) : "—";

export default function Account() {
  // signOut dropped from this destructure with the section that used it. The global control in the
  // Navbar (and the admin shell) still calls it from AuthContext.
  const { user, accessToken, updateUser } = useAuth();
  const { wishlistItems } = useContext(StoreContext);
  const [profile, setProfile] = useState({ name:user?.name || "", phoneNumber:user?.phoneNumber || "" });
  const [addresses, setAddresses] = useState([]); const [orderCount, setOrderCount] = useState(0);
  const [address, setAddress] = useState(blankAddress); const [editingId, setEditingId] = useState(null); const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const confirmAction = useConfirmAction();
  const [preferences, setPreferences] = useState(defaultPreferences); const [preferencesLoading, setPreferencesLoading] = useState(true); const [preferencesSaving, setPreferencesSaving] = useState(false);

  const load = useCallback(async () => { setLoading(true); setPreferencesLoading(true); setError(""); const [accountResult, preferenceResult] = await Promise.allSettled([Promise.all([getAddresses(accessToken), getMyOrders(accessToken)]), getCommunicationPreferences(accessToken)]); if (accountResult.status === "fulfilled") { const [saved, orders] = accountResult.value; setAddresses(saved || []); setOrderCount(orders.totalElements || orders.content?.length || 0); } else setError(accountResult.reason.message); if (preferenceResult.status === "fulfilled") setPreferences({ ...defaultPreferences, ...preferenceResult.value }); else setError((current) => current || preferenceResult.reason.message); setLoading(false); setPreferencesLoading(false); }, [accessToken]);
  useEffect(() => { load(); }, [load]);

  const saveProfile = async (event) => { event.preventDefault(); setSaving(true); setError(""); try { const updated = await updateCurrentUser(accessToken, { name:profile.name.trim(), phoneNumber:profile.phoneNumber.trim() || null }); updateUser(updated); setProfile({ name:updated.name, phoneNumber:updated.phoneNumber || "" }); setNotice("Your profile has been updated."); } catch(e) { setError(e.message); } finally { setSaving(false); } };
  const openAddress = (item) => { setEditingId(item?.addressId || null); setAddress(item ? { ...item } : { ...blankAddress, recipientName:user.name, phoneNumber:user.phoneNumber || "", isDefault:addresses.length === 0 }); setShowForm(true); setError(""); };
  const saveAddress = async (event) => { event.preventDefault(); setSaving(true); setError(""); try { const saved = editingId ? await updateAddress(accessToken, editingId, address) : await createAddress(accessToken, address); setAddresses((current) => { const next = editingId ? current.map((item) => item.addressId === saved.addressId ? saved : item) : [saved, ...current]; return saved.isDefault ? next.map((item) => ({ ...item, isDefault:item.addressId === saved.addressId })) : next; }); setShowForm(false); setNotice(`Address ${editingId ? "updated" : "added"}.`); } catch(e) { setError(e.message); } finally { setSaving(false); } };
  const makeDefault = async (id) => { try { const saved = await setDefaultAddress(accessToken, id); setAddresses((current) => current.map((item) => ({ ...item, isDefault:item.addressId === saved.addressId }))); setNotice("Default delivery address updated."); } catch(e) { setError(e.message); } };
  // Was `if (!window.confirm(...)) return;`. The dialog now carries the busy guard and shows a
  // failure in place, so the address list is only pruned after the server confirms the delete.
  const remove = (item) => confirmAction.ask({
    title: "Remove this address?",
    body: <p>The saved address for <strong>{item.recipientName}</strong> will be removed from your account. Orders already placed to it are not affected.</p>,
    confirmLabel: "Remove address",
    busyLabel: "Removing…",
    cancelLabel: "Keep address",
    run: async () => {
      await deleteAddress(accessToken, item.addressId);
      setAddresses((current) => current.filter((value) => value.addressId !== item.addressId));
      setNotice("Address removed.");
    },
  });
  const field = (name, value) => setAddress((current) => ({ ...current, [name]:value }));
  // Digits only, sanitised on entry so typed letters and pasted junk never land in the field.
  const setPincode = (value) => field("pincode", sanitisePincode(value, address.country));
  const addressPincodeError = pincodeError(address.pincode, address.country);
  // Same shared rule the checkout and registration forms use, so a number accepted in one place
  // cannot be rejected in another. Both are advisory here: the server re-validates via @IndianMobile.
  const addressPhoneError = phoneError(address.phoneNumber);
  const profilePhoneError = phoneError(profile.phoneNumber);
  const preference = (name) => (event) => setPreferences((current) => ({ ...current, [name]:event.target.checked }));
  const savePreferences = async (event) => { event.preventDefault(); setPreferencesSaving(true); setError(""); setNotice(""); try { const saved = await updateCommunicationPreferences(accessToken, preferences); setPreferences({ ...defaultPreferences, ...saved }); setNotice("Communication preferences saved."); } catch(e) { setError(e.message); } finally { setPreferencesSaving(false); } };

  return <main className="account-page"><div className="container">
    <header className="account-hero"><div><span>Your Shades World account</span><h1>Hello, {user.name?.split(" ")[0]}.</h1><p>Manage the details that follow you from checkout to delivery.</p></div><div className="account-avatar">{user.name?.charAt(0)?.toUpperCase()}</div></header>
    {error && <div className="account-alert error">{error}</div>}{notice && <div className="account-alert success">{notice}</div>}
    <section className="account-stats"><Link to="/my-orders"><span>Orders</span><strong>{loading ? "—" : orderCount}</strong><small>Track purchases →</small></Link><Link to="/wishlist"><span>Wishlist</span><strong>{wishlistItems.length}</strong><small>View saved frames →</small></Link><article><span>Member since</span><strong>{formatDate(user.createdAt)}</strong><small>{user.emailVerified ? "Email verified" : "Email verification pending"}</small></article></section>
    <div className="account-layout"><section className="account-panel"><div className="account-title"><span>Personal information</span><h2>Your profile</h2></div><form className="profile-form" onSubmit={saveProfile}><label>Full name<input value={profile.name} onChange={(e) => setProfile({...profile,name:e.target.value})} required /></label><label>Email address<input value={user.email} disabled /><small>Email cannot be changed here for account security.</small></label><label>Phone number<input value={profile.phoneNumber} maxLength="20" type="tel" inputMode="numeric" autoComplete="tel" placeholder="10-digit mobile number" onChange={(e) => setProfile({...profile,phoneNumber:e.target.value})} aria-invalid={Boolean(profilePhoneError)} aria-describedby={profilePhoneError ? "account-profile-phone-error" : undefined} />{profilePhoneError && <small id="account-profile-phone-error" className="account-field-error" role="alert">{profilePhoneError}</small>}</label><button disabled={saving || Boolean(profilePhoneError)}>Save profile</button></form></section>
      <section className="account-panel"><div className="account-title row"><div><span>Checkout & delivery</span><h2>Saved addresses</h2></div><button onClick={() => openAddress(null)}>+ Add address</button></div>{loading ? <p className="account-empty">Loading addresses…</p> : !addresses.length ? <p className="account-empty">No saved addresses yet.</p> : <div className="account-addresses">{addresses.map((item) => <article key={item.addressId}><header><strong>{item.recipientName}</strong>{item.isDefault && <em>Default</em>}</header><p>{item.houseNumber && `${item.houseNumber}, `}{item.addressLine1}{item.addressLine2 && `, ${item.addressLine2}`}<br/>{item.city}, {item.state} {item.pincode}<br/>{item.country} · {item.phoneNumber || "No phone"}</p><footer><button onClick={() => openAddress(item)}>Edit</button>{!item.isDefault && <button onClick={() => makeDefault(item.addressId)}>Make default</button>}<button className="remove" onClick={() => remove(item)}>Remove</button></footer></article>)}</div>}</section></div>
    <CommunicationPreferences value={preferences} loading={preferencesLoading} saving={preferencesSaving} onChange={preference} onSave={savePreferences} />
  </div>{showForm && <div className="account-modal" onMouseDown={() => !saving && setShowForm(false)}><form onSubmit={saveAddress} onMouseDown={(e) => e.stopPropagation()}><header><div><span>Delivery details</span><h2>{editingId ? "Edit address" : "Add an address"}</h2></div><button type="button" onClick={() => setShowForm(false)}>×</button></header><div className="address-grid"><label>Type<select value={address.addressType} onChange={(e)=>field("addressType",e.target.value)}><option value="SHIPPING">Shipping</option><option value="BILLING">Billing</option><option value="BOTH">Shipping & billing</option></select></label><label>Recipient<input value={address.recipientName} onChange={(e)=>field("recipientName",e.target.value)} required /></label><label>Phone<input value={address.phoneNumber || ""} type="tel" inputMode="numeric" autoComplete="tel" maxLength="20" placeholder="10-digit mobile number" onChange={(e)=>field("phoneNumber",e.target.value)} aria-invalid={Boolean(addressPhoneError)} aria-describedby={addressPhoneError ? "account-address-phone-error" : undefined} />{addressPhoneError && <small id="account-address-phone-error" className="account-field-error" role="alert">{addressPhoneError}</small>}</label><label>House / flat<input value={address.houseNumber || ""} onChange={(e)=>field("houseNumber",e.target.value)} /></label><label className="wide">Address line 1<input value={address.addressLine1} onChange={(e)=>field("addressLine1",e.target.value)} required /></label><label className="wide">Address line 2<input value={address.addressLine2 || ""} onChange={(e)=>field("addressLine2",e.target.value)} /></label><label>City<input value={address.city} onChange={(e)=>field("city",e.target.value)} required /></label><label>State<input value={address.state} onChange={(e)=>field("state",e.target.value)} required /></label><label>Pincode<input value={address.pincode} onChange={(e)=>setPincode(e.target.value)} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="postal-code" aria-invalid={Boolean(addressPincodeError)} aria-describedby={addressPincodeError ? "account-pincode-error" : undefined} required />{addressPincodeError && <small id="account-pincode-error" className="account-field-error" role="alert">{addressPincodeError}</small>}</label><label>Country<input value={address.country} onChange={(e)=>field("country",e.target.value)} required /></label><label className="wide check"><input type="checkbox" checked={Boolean(address.isDefault)} onChange={(e)=>field("isDefault",e.target.checked)} /> Use as default delivery address</label></div><footer><button type="button" onClick={() => setShowForm(false)}>Cancel</button><button disabled={saving || Boolean(addressPincodeError) || Boolean(addressPhoneError)}>Save address</button></footer></form></div>}{confirmAction.dialog}</main>;
}
