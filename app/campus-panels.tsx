"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Bike, Check, CheckCircle2, Clock3, ExternalLink, KeyRound, LoaderCircle, MapPin, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import type { AccountResponse, Delivery, DeliveryBoard, Incident, RegistryEntry } from "./feature-types";
import { campusMapImageUrl, campusMapUrl, campusSourceLinks, canteens, locations } from "./campus";

export async function campusApi<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...options, signal: options?.signal || AbortSignal.timeout(15000), headers: { "Content-Type": "application/json", ...options?.headers } });
  } catch {
    throw new Error("Couldn’t connect to LunchLine. Please try again in a moment.");
  }
  let data: T & { error?: string };
  try { data = await response.json(); } catch { throw new Error("LunchLine is reconnecting. Please try again."); }
  if (!response.ok) throw new Error(data.error || "That request couldn’t be completed.");
  return data;
}

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
const locationName = (id: string) => locations.find(location => location.id === id)?.name || id;
const errorText = (error: unknown) => error instanceof Error ? error.message : "Please try again.";
const walletActivity = (kind: string) => kind === "compensation" ? "Failed delivery refund" : kind.replaceAll("_", " ");
function moment(value: string | number | null) {
  if (value === null) return "";
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return new Date(parsed).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}
function Notice({ text, error }: { text: string; error?: boolean }) {
  return <p role={error ? "alert" : "status"} className={error ? "error-message" : "save-state"}>{text}</p>;
}

type GoogleIdentity = {
  accounts: { id: {
    initialize: (options: { client_id: string; nonce: string; callback: (response: { credential: string }) => void }) => void;
    renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
  } };
};
declare global { interface Window { google?: GoogleIdentity } }

function GoogleLink({ account, onLinked }: { account: AccountResponse; onLinked: (account: AccountResponse) => void }) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!account.google.configured || account.google.linked || !account.google.clientId) return;
    let cancelled = false;
    setLoading(true); setError("");
    async function initialize() {
      try {
        const result = await campusApi<{ nonce: string; clientId: string }>("/api/google/nonce", { method: "POST", body: "{}" });
        if (cancelled || !window.google || !buttonRef.current) return;
        window.google.accounts.id.initialize({
          client_id: result.clientId,
          nonce: result.nonce,
          callback: async ({ credential }) => {
            setLoading(true); setError("");
            try {
              const linked = await campusApi<AccountResponse>("/api/google/link", { method: "POST", body: JSON.stringify({ credential }) });
              if (!cancelled) onLinked(linked);
            } catch (failure) { if (!cancelled) setError(errorText(failure)); }
            finally { if (!cancelled) setLoading(false); }
          },
        });
        buttonRef.current.replaceChildren();
        window.google.accounts.id.renderButton(buttonRef.current, { theme: "outline", size: "large", text: "continue_with", width: 290 });
      } catch (failure) { if (!cancelled) setError(errorText(failure)); }
      finally { if (!cancelled) setLoading(false); }
    }
    const failed = () => { setError("Google sign-in couldn’t load. Check your connection and reopen this page."); setLoading(false); };
    let script = document.getElementById("google-identity-services") as HTMLScriptElement | null;
    if (window.google) void initialize();
    else {
      if (!script) {
        script = document.createElement("script");
        script.id = "google-identity-services";
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", initialize);
      script.addEventListener("error", failed);
    }
    return () => { cancelled = true; script?.removeEventListener("load", initialize); script?.removeEventListener("error", failed); };
  }, [account.google.configured, account.google.clientId, account.google.linked, onLinked]);

  if (account.google.linked) return <div className="feature-callout"><CheckCircle2 size={18} /> <strong>College Google account linked</strong><p>{account.google.email}</p></div>;
  return <div>
    <p className="feature-intro">Link your college Google identity. Student benefits also require an active, approved registry record.</p>
    {account.google.configured ? <><div ref={buttonRef} className="google-link-button" />{loading && <p className="feature-note"><LoaderCircle size={15} className="loading-icon" /> Loading Google sign-in…</p>}</> : <><button className="secondary-button" disabled><KeyRound size={17} />Google activation pending</button><p className="feature-note">A Google OAuth client ID must be configured by the pilot administrator before linking becomes available.</p></>}
    {error && <Notice text={error} error />}
  </div>;
}

export function AccountWalletPanel({ account, onLinked, onRefresh, onBrowse }: { account: AccountResponse | null; onLinked: (account: AccountResponse) => void; onRefresh: () => Promise<void>; onBrowse: () => void }) {
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function repay(id: string) {
    setBusyId(id); setError(""); setMessage("");
    try {
      await campusApi("/api/incidents/" + encodeURIComponent(id) + "/repay", { method: "POST", body: "{}" });
      await onRefresh(); setMessage("Test settlement recorded.");
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusyId(""); }
  }
  if (!account) return <main className="account-page"><div className="feature-loading"><LoaderCircle className="loading-icon" size={25} /> Loading your account…</div></main>;
  const profile = account.profile;
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const currentApproval = !!profile?.active && profile.expiresOn >= today;
  return <main className="account-page">
    <div className="page-intro"><div><h1>Account & wallet</h1><p>Your college identity, approved benefits and campus delivery credits.</p></div><button className="secondary-button" onClick={() => void onRefresh()} aria-label="Refresh account"><RefreshCw size={16} />Refresh</button></div>
    {error && <Notice text={error} error />}{message && <Notice text={message} />}
    <div className="feature-layout">
      <section className="feature-section"><h2><ShieldCheck size={21} /> College account</h2><GoogleLink account={account} onLinked={onLinked} />
        <dl className="account-data"><div><dt>Registry status</dt><dd>{currentApproval ? "Approved and active" : profile && profile.expiresOn < today ? "Approval expired" : profile ? "Inactive" : "Awaiting registry approval"}</dd></div>
          <div><dt>Campus role</dt><dd>{profile?.role || "Not yet confirmed"}</dd></div>
          {profile?.studentId && <div><dt>Student ID</dt><dd>{profile.studentId}</dd></div>}
          <div><dt>Residence</dt><dd>{profile?.residence === "day_scholar" ? "Day scholar" : profile?.residence === "hostel" ? "Hostel" : "Not applicable / unconfirmed"}</dd></div>
          <div><dt>Need approval</dt><dd>{profile?.needApproved ? "Approved" : "Not approved"}</dd></div>
          {profile && <div><dt>Registry expires</dt><dd>{profile.expiresOn}</dd></div>}
        </dl><p className="feature-note">Role, residence and benefit approval come from the college registry. Ask the pilot administrator to correct a record.</p>
      </section>
      <div><section className="feature-section account-summary"><h2><Wallet size={22} /> Internal wallet</h2><div className="wallet-amount">{money(account.wallet.balance)}</div><p className="feature-intro">Available campus credit</p><p className="feature-note">Verified completed deliveries earn a minimum ₹10 credit. Apply available credit during checkout.</p><button className="secondary-button" onClick={onBrowse}>Browse the menu</button></section>
        <section className="feature-section"><h2>Student benefit</h2><p className="feature-intro">{account.discount.description}</p><div className="feature-callout"><strong>Approved hostel students</strong><p>10% off the food subtotal of every order.</p><strong>Approved day scholars</strong><p>25% off one eligible meal unit per India calendar day.</p></div><p className="feature-note">Both benefits require linked college identity, an active student record and need approval. Checkout shows the server-confirmed amount.</p></section></div>
    </div>
    <section className="feature-section"><h2>Wallet activity</h2>{account.wallet.entries.length ? <div className="ledger-scroll"><table className="wallet-ledger"><thead><tr><th>Activity</th><th>Date · IST</th><th>Credit / debit</th></tr></thead><tbody>{account.wallet.entries.map(entry => <tr key={entry.id}><td>{walletActivity(entry.kind)}</td><td>{moment(entry.createdAt)}</td><td className={entry.amount > 0 ? "positive-amount" : ""}>{entry.amount > 0 ? "+" : ""}{money(entry.amount)}</td></tr>)}</tbody></table></div> : <p className="feature-intro">Your delivery credits and checkout spending will appear here.</p>}</section>
    {account.incidents.length > 0 && <section className="feature-section"><h2>Delivery reviews</h2><p className="feature-intro">Reviews stay open until the vendor checks the handoff. Any fine requires a recorded reason.</p><div className="delivery-list">{account.incidents.map(incident => <div className="delivery-card" key={incident.id}><div className="delivery-card-header"><h3>{incident.status.replaceAll("_", " ")}</h3><span className="status-label">{money(incident.fine)}</span></div><p>{incident.reason}</p>{incident.status === "fined" && <button className="secondary-button" style={{ marginTop: 12 }} disabled={busyId === incident.id} onClick={() => void repay(incident.id)}>{busyId === incident.id ? "Recording…" : "Record test settlement"}</button>}</div>)}</div></section>}
  </main>;
}

function DeliveryTask({ delivery, busy, onAction }: { delivery: Delivery; busy: boolean; onAction: (id: string, action: string, payload: Record<string, unknown>) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  async function action(name: string, payload: Record<string, unknown> = {}) {
    setError("");
    try { await onAction(delivery.orderId, name, payload); setCode(""); setReporting(false); }
    catch (failure) { setError(errorText(failure)); }
  }
  return <article className="delivery-card">
    <div className="delivery-card-header"><div><h3>#{delivery.token}</h3><p className="delivery-route"><MapPin size={16} />{locationName(delivery.destination)}</p></div><span className="delivery-credit">{money(delivery.fee)}</span></div>
    <p>{delivery.items.map(item => item.quantity + " × " + item.name).join(", ")}</p>
    <div className="feature-actions"><span className="status-label">{delivery.status.replaceAll("_", " ")}</span>{delivery.deadlineAt && <span className="feature-note deadline-note">Deliver by {moment(delivery.deadlineAt)}</span>}</div>
    {delivery.status === "claimed" && <><p className="feature-note">Collect by {moment(delivery.claimExpiresAt)}. Ask the vendor for the pickup code at handoff.</p><form className="inline-code-form" onSubmit={event => { event.preventDefault(); void action("pickup", { code: code.trim() }); }}><label className="form-field"><span>Vendor pickup code</span><input required value={code} maxLength={20} disabled={busy} onChange={event => setCode(event.target.value)} autoComplete="one-time-code" /></label><button className="primary-button" disabled={busy}>{busy ? "Checking…" : "Confirm pickup"}</button></form><button className="order-cancel" disabled={busy} onClick={() => void action("release")}>Release claim before pickup</button></>}
    {delivery.status === "picked_up" && <p className="feature-note">Deliver within 30 minutes of pickup. The recipient confirms receipt from My orders. Credit follows that confirmation.</p>}
    {(delivery.status === "picked_up" || delivery.status === "review_hold") && <>{!reporting ? <button className="order-cancel" disabled={busy} onClick={() => setReporting(true)}>Report a handoff problem</button> : <form onSubmit={event => { event.preventDefault(); void action("report", { reason: reason.trim() }); }}><label className="form-field" style={{ marginTop: 15 }}><span>What happened?</span><textarea required maxLength={400} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="Briefly describe the handoff issue." /></label><button className="secondary-button" disabled={busy}>Send for vendor review</button></form>}</>}
    {error && <Notice text={error} error />}
  </article>;
}

export function CampusDeliveryPanel({ onAccountRefresh }: { onAccountRefresh: () => Promise<void> }) {
  const [board, setBoard] = useState<DeliveryBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [busyId, setBusyId] = useState("");
  const [destination, setDestination] = useState("");
  const [zone, setZone] = useState("all");
  const load = useCallback(async () => {
    try { setBoard(await campusApi<DeliveryBoard>("/api/deliveries")); setError(""); }
    catch (failure) { setError(errorText(failure)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 8000); return () => window.clearInterval(timer); }, [load]);
  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusyId("presence"); setError("");
    try { await campusApi("/api/deliveries/presence", { method: "POST", body: JSON.stringify({ code: code.trim() }) }); setCode(""); await load(); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusyId(""); }
  }
  async function action(id: string, name: string, payload: Record<string, unknown>) {
    setBusyId(id);
    try { await campusApi("/api/deliveries/" + encodeURIComponent(id) + "/" + name, { method: "POST", body: JSON.stringify(payload) }); await load(); await onAccountRefresh(); }
    finally { setBusyId(""); }
  }
  const mine = board?.deliveries.filter(delivery => delivery.isMine && ["claimed", "picked_up", "review_hold"].includes(delivery.status)) || [];
  const unlocked = !!board?.presenceUntil && board.presenceUntil > Date.now();
  const ready = board?.deliveries.filter(delivery => delivery.status === "open" && !delivery.isMine && (!destination || delivery.destination === destination)) || [];
  return <main className="campus-page">
    <div className="page-intro"><div><h1>Campus & delivery</h1><p>Find your drop-off point. Pick up a delivery when you’re already at the counter.</p></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} />Refresh</button></div>
    {error && <Notice text={error} error />}
    <div className="feature-layout">
      <section className="feature-section"><h2><MapPin size={21} /> NITC campus</h2><p className="feature-intro">Use the official map to orient yourself and filter ready deliveries by destination.</p><a className="official-map" href={campusMapUrl} target="_blank" rel="noreferrer"><img src={campusMapImageUrl} alt="Official NIT Calicut campus map" /></a><a className="text-link" href={campusMapUrl} target="_blank" rel="noreferrer">Open the official map PDF <ExternalLink size={14} /></a>
        <div className="form-row" style={{ marginTop: 18 }}><label className="form-field"><span>Campus area</span><select value={zone} onChange={event => { setZone(event.target.value); setDestination(""); }}><option value="all">All areas</option><option value="east">East Campus</option><option value="academic">Academic campus</option><option value="hostels">Hostels</option><option value="west">West Campus</option></select></label><label className="form-field"><span>Delivery destination filter</span><select value={destination} onChange={event => setDestination(event.target.value)}><option value="">Any destination</option>{locations.filter(location => zone === "all" || location.zone === zone).map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label></div>
        {destination && <div className="feature-callout"><strong>{locationName(destination)}</strong><p>{locations.find(location => location.id === destination)?.description}</p></div>}
        <p className="feature-note">Location names come from official NITC sources. Delivery fees use order-value tiers shown at checkout.</p>
      </section>
      <section className="feature-section"><h2><Bike size={23} /> Peer delivery desk</h2><p className="feature-intro">Up to 5 active claims. Deliver within 30 minutes after pickup and earn at least ₹10 on confirmed completion.</p>
        {loading ? <div className="feature-loading"><LoaderCircle className="loading-icon" size={24} /> Loading deliveries…</div> : !board?.canDeliver ? <div className="feature-callout">Courier access needs a linked college identity and an active approved registry account. Check Account & wallet for your status.</div> : <>
          {!unlocked ? <form className="delivery-gate" onSubmit={unlock}><h3>At the vendor counter?</h3><p className="feature-intro">Ask the vendor for the current counter code to view and claim ready food.</p><label className="form-field"><span>Counter presence code</span><input required maxLength={20} value={code} disabled={busyId === "presence"} onChange={event => setCode(event.target.value)} autoComplete="one-time-code" /></label><button className="primary-button" disabled={busyId === "presence"}><KeyRound size={16} />{busyId === "presence" ? "Checking…" : "Unlock ready deliveries"}</button></form> : <><div className="feature-callout"><strong>Counter access active</strong><p>Until {moment(board.presenceUntil)} · {mine.length} of 5 active claims</p></div><p className="delivery-alert" role="status" aria-live="polite" aria-atomic="true"><Bike size={16} />{ready.length} ready {ready.length === 1 ? "delivery" : "deliveries"}{destination ? " to " + locationName(destination) : " across campus"}</p><div className="delivery-list">{ready.map(delivery => <div className="delivery-card" key={delivery.orderId}><div className="delivery-card-header"><h3>#{delivery.token}</h3><span className="delivery-credit">Earn {money(delivery.fee)}</span></div><p className="delivery-route"><MapPin size={16} />{locationName(delivery.destination)}</p><p>{delivery.items.map(item => item.quantity + " × " + item.name).join(", ")}</p><button className="primary-button" style={{ marginTop: 15 }} disabled={!!busyId || mine.length >= 5} onClick={() => { void action(delivery.orderId, "claim", {}).catch(failure => setError(errorText(failure))); }}>{busyId === delivery.orderId ? "Claiming…" : "Claim ready order"}</button></div>)}{ready.length === 0 && <p className="feature-intro">No ready food matches this destination. The board updates automatically.</p>}</div></>}
        </>}
      </section>
    </div>
    {mine.length > 0 && <section className="feature-section"><h2>Your active deliveries</h2><div className="delivery-columns">{mine.map(delivery => <DeliveryTask key={delivery.orderId} delivery={delivery} busy={busyId === delivery.orderId} onAction={action} />)}</div></section>}
    <section className="feature-section"><h2>Campus canteen directory</h2><p className="feature-intro">The pilot pickup location is East Campus Canteen. Other outlets below are campus directory listings.</p><div className="canteen-directory">{canteens.map(canteen => <article key={canteen.id}><h3>{canteen.name}</h3><p>{canteen.description}</p></article>)}</div><div className="feature-actions">{campusSourceLinks.slice(0, 3).map(source => <a className="text-link" key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<ExternalLink size={13} /></a>)}</div></section>
  </main>;
}

export function RecipientDeliveryPanel({ orderId, recipientCode, deliveryStatus, onRefresh }: { orderId: string; recipientCode?: string; deliveryStatus?: string; onRefresh: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await campusApi("/api/deliveries/" + encodeURIComponent(orderId) + "/confirm", { method: "POST", body: JSON.stringify({ code: code.trim() }) }); setCode(""); onRefresh(); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  if (!recipientCode || deliveryStatus === "delivered") return null;
  return <div className="recipient-confirm"><p className="feature-note">After receiving your food, enter your receipt code to complete the delivery.</p><div className="delivery-code" aria-label={"Your receipt code is " + recipientCode}>{recipientCode}</div><form className="inline-code-form" onSubmit={confirm}><label className="form-field"><span>Receipt code</span><input required value={code} maxLength={20} disabled={busy} onChange={event => setCode(event.target.value)} autoComplete="one-time-code" /></label><button className="secondary-button" disabled={busy}>{busy ? "Confirming…" : "I received my food"}</button></form>{error && <Notice text={error} error />}</div>;
}

export function RegistryPanel() {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<RegistryEntry | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const load = useCallback(async () => { try { setEntries((await campusApi<{ entries: RegistryEntry[] }>("/api/vendor/registry")).entries); setError(""); } catch (failure) { setError(errorText(failure)); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    const entry: RegistryEntry = { email: String(form.get("email")).trim(), studentId: String(form.get("studentId") || "").trim() || null, role: String(form.get("role")) as RegistryEntry["role"], residence: String(form.get("residence")) as RegistryEntry["residence"], needApproved: form.get("needApproved") === "on", active: form.get("active") === "on", expiresOn: String(form.get("expiresOn")) };
    try { await campusApi("/api/vendor/registry", { method: "POST", body: JSON.stringify(entry) }); setMessage("Registry entry saved."); setEditing(null); formRef.current?.reset(); await load(); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  return <section className="feature-section"><h2>Approved campus registry</h2><p className="feature-intro">Confirm college role, residence and need approval here. Keep supporting need evidence outside LunchLine.</p>{error && <Notice text={error} error />}{message && <Notice text={message} />}
    <form className="registry-form" onSubmit={save} key={editing?.email || "new-entry"} ref={formRef}>
      <label className="form-field"><span>College email</span><input name="email" type="email" required maxLength={200} disabled={busy} defaultValue={editing?.email || ""} /></label>
      <label className="form-field"><span>Student ID</span><input name="studentId" maxLength={60} disabled={busy} defaultValue={editing?.studentId || ""} placeholder="For student records" /></label>
      <label className="form-field"><span>Campus role</span><select name="role" disabled={busy} defaultValue={editing?.role || "student"}><option value="student">Student</option><option value="faculty">Faculty</option><option value="staff">Staff</option></select></label>
      <label className="form-field"><span>Residence</span><select name="residence" disabled={busy} defaultValue={editing?.residence || "none"}><option value="none">Not applicable</option><option value="hostel">Hostel</option><option value="day_scholar">Day scholar</option></select></label>
      <label className="form-field"><span>Valid until</span><input name="expiresOn" type="date" required disabled={busy} defaultValue={editing?.expiresOn || ""} /></label>
      <div><label className="check-label" style={{ margin: "7px 0 13px" }}><input name="needApproved" type="checkbox" disabled={busy} defaultChecked={editing?.needApproved || false} />Need approval confirmed</label><label className="check-label"><input name="active" type="checkbox" disabled={busy} defaultChecked={editing?.active ?? true} />Active registry record</label></div>
      <div className="feature-actions"><button className="primary-button" disabled={busy}>{busy ? "Saving…" : editing ? "Update registry entry" : "Add approved entry"}</button>{editing && <button className="secondary-button" type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel edit</button>}</div>
    </form>
    <div className="registry-list">{entries.map(entry => <article className="registry-row" key={entry.email}><div><h3>{entry.email}</h3><p>{entry.studentId || "No student ID"} · {entry.role} · {entry.residence.replaceAll("_", " ")} · {entry.active ? "Active" : "Inactive"}</p><p>Need approval {entry.needApproved ? "confirmed" : "pending"} · Expires {entry.expiresOn}</p></div><button className="secondary-button" onClick={() => { setEditing(entry); formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>Edit entry</button></article>)}</div>
  </section>;
}

function IncidentReview({ incident, delivery, onReviewed }: { incident: Incident; delivery?: Delivery; onReviewed: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [fine, setFine] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canRefund = delivery?.status === "review_hold" && delivery.deadlineAt !== null;
  async function review(action: "clear" | "fine" | "refund") {
    setBusy(true); setError("");
    try { await campusApi("/api/vendor/incidents/" + encodeURIComponent(incident.id), { method: "PATCH", body: JSON.stringify({ action, reason: reason.trim(), fine: action === "fine" ? Number(fine) : 0 }) }); await onReviewed(); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  return <article className="delivery-card">
    <div className="delivery-card-header"><h3>Delivery review</h3><span className="status-label">{incident.status}</span></div>
    <p>{incident.reason}</p><p className="feature-note">{moment(incident.createdAt)}</p>
    {delivery?.status === "failed" && <p className="feature-callout">The recipient’s test-paid balance has been credited to their internal wallet.</p>}
    {(incident.status === "open" || canRefund) && <form onSubmit={event => { event.preventDefault(); void review("fine"); }}>
      <label className="form-field" style={{ marginTop: 16 }}><span>Review decision reason</span><textarea required minLength={5} maxLength={400} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} /></label>
      {incident.status === "open" && <>
        <label className="form-field"><span>Proportionate fine (₹)</span><input required type="number" min="0.01" step="0.01" disabled={busy} value={fine} onChange={event => setFine(event.target.value)} /></label>
        <p className="feature-note">The server caps the fine at the order’s food value. Record a reason for either decision.</p>
        <div className="feature-actions"><button className="secondary-button" type="button" disabled={busy || reason.trim().length < 5} onClick={() => void review("clear")}>Clear incident</button><button className="primary-button" disabled={busy || reason.trim().length < 5}>Apply reviewed fine</button></div>
      </>}
      {canRefund && <><p className="feature-note">For a confirmed failed handoff, credit the recipient’s test-paid balance to their internal wallet.</p><button className="secondary-button" type="button" style={{ marginTop: 12 }} disabled={busy || reason.trim().length < 5} onClick={() => void review("refund")}>Refund recipient balance</button></>}
    </form>}
    {error && <Notice text={error} error />}
  </article>;
}

export function DeliveryDeskPanel() {
  const [board, setBoard] = useState<DeliveryBoard | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { try { setBoard(await campusApi<DeliveryBoard>("/api/vendor/deliveries")); setError(""); } catch (failure) { setError(errorText(failure)); } }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 8000); return () => window.clearInterval(timer); }, [load]);
  return <section className="feature-section"><div className="section-heading"><h2>Delivery desk & reviews</h2><button className="secondary-button" onClick={() => void load()}><RefreshCw size={15} />Refresh</button></div>{error && <Notice text={error} error />}{!board ? <p className="feature-intro">Loading the delivery desk…</p> : <><div className="feature-callout"><strong>Current counter presence code</strong><div><span className="delivery-code">{board.counterCode || "Unavailable"}</span></div><p>Show this code at the vendor counter to couriers collecting ready food.</p></div><div className="delivery-columns">{board.deliveries.map(delivery => <article className="delivery-card" key={delivery.orderId}><div className="delivery-card-header"><h3>#{delivery.token}</h3><span className="status-label">{delivery.status.replaceAll("_", " ")}</span></div><p className="delivery-route"><MapPin size={15} />{locationName(delivery.destination)}</p>{delivery.courierName && <p>Courier {delivery.courierName}</p>}{delivery.pickupCode && delivery.status === "claimed" && <><p className="feature-note">Give the pickup code to the assigned courier at handoff.</p><span className="delivery-code">{delivery.pickupCode}</span></>}{delivery.deadlineAt && <p className="feature-note">Delivery deadline {moment(delivery.deadlineAt)}</p>}</article>)}</div><h3 style={{ marginTop: 26 }}>Incidents awaiting review</h3><div className="delivery-columns">{board.incidents.map(incident => <IncidentReview key={incident.id} incident={incident} delivery={board.deliveries.find(delivery => delivery.orderId === incident.orderId)} onReviewed={load} />)}{board.incidents.length === 0 && <p className="feature-intro">No delivery incidents to review.</p>}</div></>}</section>;
}

export function GoogleSetupPanel() {
  const [clientId, setClientId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); void campusApi<{ googleClientId: string | null }>("/api/vendor/config").then(data => { setClientId(data.googleClientId || ""); setLoaded(true); }).catch(failure => setError(errorText(failure))); }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { await campusApi("/api/vendor/config", { method: "PATCH", body: JSON.stringify({ googleClientId: clientId.trim() }) }); setMessage("Google client ID saved. Account linking is now available to configured college identities."); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  return <section className="feature-section"><h2>College Google account setup</h2><p className="feature-intro">Connect your Google OAuth web client to activate college identity linking. The server verifies Google identity tokens and registry eligibility.</p><div className="feature-callout"><strong>Authorized JavaScript origin</strong><p className="origin-text">{origin}</p></div><form onSubmit={save} style={{ maxWidth: 650, marginTop: 22 }}><label className="form-field"><span>Google OAuth web client ID</span><input required disabled={!loaded || busy} maxLength={240} value={clientId} onChange={event => setClientId(event.target.value)} placeholder="…apps.googleusercontent.com" /></label><button className="primary-button" disabled={!loaded || busy}>{busy ? "Saving…" : "Activate Google linking"}</button></form><p className="feature-note">Enter the public client ID only. Keep OAuth client secrets out of this form.</p>{message && <Notice text={message} />}{error && <Notice text={error} error />}</section>;
}


