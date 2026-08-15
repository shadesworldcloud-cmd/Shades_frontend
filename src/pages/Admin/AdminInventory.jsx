import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { adjustInventory, getAdminProducts, getInventoryMovements, updateLowStockThreshold } from "../../services/api";
import { announceCatalogueChanged } from "../../services/catalogueEvents";
import "./AdminOperations.css";
import "./InventoryEnhancements.css";

const when = (value) => value ? new Date(value).toLocaleString("en-IN", { dateStyle:"medium", timeStyle:"short" }) : "—";
const health = (row) => !row.productActive || !row.isActive ? "inactive" : row.quantityAvailable === 0 ? "out" : row.quantityAvailable <= row.lowStockThreshold ? "low" : "healthy";
const healthLabel = { inactive:"Inactive", out:"Out of stock", low:"Low stock", healthy:"Healthy" };

export default function AdminInventory() {
  const { accessToken } = useAuth();
  const [rows,setRows]=useState([]); const [query,setQuery]=useState(""); const [filter,setFilter]=useState("all");
  const [selected,setSelected]=useState(null); const [movements,setMovements]=useState([]); const [movementFilter,setMovementFilter]=useState("all");
  const [amount,setAmount]=useState(""); const [reason,setReason]=useState(""); const [movementType,setMovementType]=useState("PURCHASE"); const [threshold,setThreshold]=useState("");
  const [loading,setLoading]=useState(true); const [saving,setSaving]=useState(false); const [error,setError]=useState(""); const [notice,setNotice]=useState("");

  const load=useCallback(async()=>{
    setLoading(true); setError("");
    try {
      const page=await getAdminProducts(accessToken);
      const inventoryRows=(page.content||[]).flatMap((product)=>(product.variants||[]).map((variant)=>({
        ...variant, productId:product.productId, productName:product.productName,
        productActive:product.isActive, brand:product.brand||"No brand",
        image:product.images?.find((item)=>item.isPrimary)?.imageUrl||product.images?.[0]?.imageUrl,
      })));
      setRows(inventoryRows);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  },[accessToken]);
  useEffect(()=>{load()},[load]);
  const filtered=useMemo(()=>{
    const rank={out:0,low:1,healthy:2,inactive:3};
    return rows.filter((row)=>{
      const term=query.trim().toLowerCase();
      const matches=!term||row.productName.toLowerCase().includes(term)||row.sku.toLowerCase().includes(term)
        ||(row.variantName||"").toLowerCase().includes(term)||(row.brand||"").toLowerCase().includes(term);
      return matches&&(filter==="all"||health(row)===filter);
    }).sort((a,b)=>rank[health(a)]-rank[health(b)]||a.quantityAvailable-b.quantityAvailable);
  },[rows,query,filter]);
  const movementTypes=useMemo(()=>["all",...new Set(movements.map((item)=>item.movementType))],[movements]);
  const displayedMovements=movementFilter==="all"?movements:movements.filter((item)=>item.movementType===movementFilter);
  const open=async(row)=>{setSelected(row);setThreshold(String(row.lowStockThreshold));setAmount("");setReason("");setMovementType("PURCHASE");setMovementFilter("all");setError("");try{const page=await getInventoryMovements(accessToken,row.variantId);setMovements(page.content||[])}catch(e){setError(e.message)}};
  const refreshMovements=async(id)=>{const page=await getInventoryMovements(accessToken,id);setMovements(page.content||[])};
  const adjust=async(event)=>{event.preventDefault();const value=Number(amount);if(!value)return setError("Quantity change must not be zero.");if(movementType==="PURCHASE"&&value<1)return setError("Received stock must be a positive quantity.");setSaving(true);setError("");try{await adjustInventory(accessToken,selected.variantId,value,movementType,reason);const updated={...selected,quantityAvailable:selected.quantityAvailable+value};setRows((current)=>current.map((row)=>row.variantId===updated.variantId?updated:row));setSelected(updated);await refreshMovements(updated.variantId);announceCatalogueChanged();setAmount("");setReason("");setNotice("Inventory movement recorded.")}catch(e){setError(e.message)}finally{setSaving(false)}};
  const saveThreshold=async(event)=>{event.preventDefault();setSaving(true);setError("");try{const updated=await updateLowStockThreshold(accessToken,selected.variantId,Number(threshold));const row={...selected,lowStockThreshold:updated.lowStockThreshold};setSelected(row);setRows((current)=>current.map((item)=>item.variantId===row.variantId?row:item));setNotice("Low-stock threshold updated.")}catch(e){setError(e.message)}finally{setSaving(false)}};
  const exportCsv=()=>{const quote=(value)=>`"${String(value??"").replaceAll('"','""')}"`;const lines=[["SKU","Product","Variant","Brand","Stock","Low stock threshold","Health","Storefront active"],...filtered.map((row)=>[row.sku,row.productName,row.variantName||"Default",row.brand,row.quantityAvailable,row.lowStockThreshold,healthLabel[health(row)],row.productActive&&row.isActive?"Yes":"No"])].map((line)=>line.map(quote).join(","));const url=URL.createObjectURL(new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download=`inventory-${new Date().toISOString().slice(0,10)}.csv`;link.click();URL.revokeObjectURL(url)};
  const active=rows.filter((row)=>row.productActive&&row.isActive); const total=active.reduce((sum,row)=>sum+row.quantityAvailable,0);

  return <section className="ops-admin inventory-admin">{error&&<div className="admin-alert error">{error}</div>}{notice&&<div className="admin-alert success">{notice}</div>}<div className="ops-title"><div><h2>Inventory control</h2><p>Monitor sellable SKUs, receive stock and keep low-stock alerts useful.</p></div><div className="inventory-title-actions"><button onClick={exportCsv} disabled={!filtered.length}>Export CSV</button><button onClick={load}>Refresh</button></div></div>
    <div className="ops-stats"><article><span>Active SKUs</span><strong>{active.length}</strong></article><article><span>Sellable units</span><strong>{total}</strong></article><article className={active.some((row)=>health(row)==="low")?"attention":""}><span>Low stock</span><strong>{active.filter((row)=>health(row)==="low").length}</strong></article><article className={active.some((row)=>health(row)==="out")?"critical":""}><span>Out of stock</span><strong>{active.filter((row)=>health(row)==="out").length}</strong></article></div>
    <div className="ops-filters"><input placeholder="Search product, variant, brand or SKU" value={query} onChange={(e)=>setQuery(e.target.value)}/><select value={filter} onChange={(e)=>setFilter(e.target.value)}><option value="all">All stock health</option><option value="out">Out of stock</option><option value="low">Low stock</option><option value="healthy">Healthy</option><option value="inactive">Inactive</option></select><span>{filtered.length} displayed</span></div>
    <div className="ops-list">{loading?<div className="ops-empty">Loading inventory…</div>:!filtered.length?<div className="ops-empty">No inventory entries match these filters.</div>:filtered.map((row)=><button className="inventory-row" key={row.variantId} onClick={()=>open(row)}><span className="ops-thumb">{row.image?<img src={row.image} alt=""/>:"SW"}</span><span><b>{row.productName}</b><small>{row.variantName||"Default variant"} · {row.brand}</small></span><span><small>SKU</small><b>{row.sku}</b></span><span><small>Alert at</small><b>{row.lowStockThreshold}</b></span><span><strong className={health(row)==="out"||health(row)==="low"?"danger-text":""}>{row.quantityAvailable} units</strong><em className={`stock-health ${health(row)}`}>{healthLabel[health(row)]}</em></span><span>Manage →</span></button>)}</div>
    {selected&&<div className="ops-backdrop" onMouseDown={()=>setSelected(null)}><aside className="ops-drawer" onMouseDown={(e)=>e.stopPropagation()}><header><div><span>{selected.sku}</span><h2>{selected.productName}</h2><p>{selected.variantName||"Default variant"} · {selected.brand}</p></div><button onClick={()=>setSelected(null)}>×</button></header><div className={`stock-hero ${health(selected)}`}><span>{healthLabel[health(selected)]}</span><strong>{selected.quantityAvailable}</strong><small>units available · alert at {selected.lowStockThreshold}</small></div>
      <section><h3>Record stock movement</h3><form className="stock-form enhanced" onSubmit={adjust}><label>Operation<select value={movementType} onChange={(e)=>{setMovementType(e.target.value);setAmount("")}}><option value="PURCHASE">Receive stock</option><option value="ADJUSTMENT">Stock correction</option></select></label><label>Quantity change<input type="number" min={movementType==="PURCHASE"?1:undefined} value={amount} onChange={(e)=>setAmount(e.target.value)} placeholder={movementType==="PURCHASE"?"Units received":"Use -5 or +10"} required/></label><label className="reason">Reason<input value={reason} maxLength="500" onChange={(e)=>setReason(e.target.value)} placeholder="Supplier delivery, count correction, damage…" required/></label><button disabled={saving}>{saving?"Saving…":"Record"}</button></form></section>
      <section><h3>Low-stock alert</h3><form className="threshold-form" onSubmit={saveThreshold}><label>Notify the team when stock reaches<input type="number" min="0" max="1000000" value={threshold} onChange={(e)=>setThreshold(e.target.value)} required/></label><button disabled={saving}>Update threshold</button></form></section>
      <section><div className="movement-heading"><h3>Movement history</h3><select value={movementFilter} onChange={(e)=>setMovementFilter(e.target.value)}>{movementTypes.map((type)=><option key={type} value={type}>{type==="all"?"All movements":type.replaceAll("_"," ")}</option>)}</select></div>{!displayedMovements.length?<p>No movements match this view.</p>:displayedMovements.map((movement)=><div className="movement-row" key={movement.inventoryMovementId}><strong className={movement.quantityChange>0?"positive":"danger-text"}>{movement.quantityChange>0?"+":""}{movement.quantityChange}</strong><span><b>{movement.movementType.replaceAll("_"," ")}</b><small>{movement.notes||"No reason"} · {when(movement.createdAt)}</small>{movement.referenceId&&<small>Reference: {movement.referenceType||"record"} #{movement.referenceId}</small>}</span></div>)}</section>
    </aside></div>}</section>;
}
