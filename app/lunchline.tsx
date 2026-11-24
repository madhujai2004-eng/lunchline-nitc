"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Bike, Check, CheckCircle2, ChefHat, Clock3, Coffee, Leaf, LoaderCircle, MapPin, Minus, PackageCheck, Plus, ReceiptText, Search, ShieldCheck, ShoppingBag, UtensilsCrossed, Users, Wallet, X } from "lucide-react";
import type { CatalogResponse, MenuItem, Order, Slot } from "./types";
import type { AccountResponse, Quote, QuoteRequest } from "./feature-types";
import { locations } from "./campus";
import { AccountWalletPanel, CampusDeliveryPanel, DeliveryDeskPanel, GoogleSetupPanel, RecipientDeliveryPanel, RegistryPanel, campusApi as api } from "./campus-panels";

type View = "menu" | "orders" | "campus" | "account" | "vendor";
type Mode = "express" | "meal";
type CartLine = { menuItemId: string; quantity: number };
type Message = { text: string; error?: boolean };
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
const statusNames: Record<Order["status"], string> = { confirmed: "Confirmed", preparing: "Preparing", ready: "Ready to collect", collected: "Collected", cancelled: "Cancelled", refunded: "Refunded to wallet" };
const steps: Order["status"][] = ["confirmed", "preparing", "ready", "collected"];
const modeName = (mode: Mode) => mode === "express" ? "Today’s menu" : "Meals for tomorrow";
const groupNames = { meals: "Meals", biryani: "Biryani", snacks: "Snacks", desserts: "Desserts", drinks: "Drinks" };

function VegMark({ vegetarian }: { vegetarian: boolean }) {
  return <span className={"veg-dot" + (vegetarian ? "" : " nonveg")} aria-label={vegetarian ? "Vegetarian" : "Non-vegetarian"} />;
}

function Status({ status }: { status: Order["status"] }) {
  return <span className={"status-label " + status}>{status === "ready" ? <CheckCircle2 size={13} /> : status === "preparing" ? <ChefHat size={13} /> : status === "confirmed" ? <Clock3 size={13} /> : <Check size={13} />}{statusNames[status]}</span>;
}

function OrderCard({ order, vendor, busy, onStatus, onCancel, onRefresh, onDeliveryDesk }: { order: Order; vendor?: boolean; busy: boolean; onStatus?: (id: string, status: Order["status"]) => void; onCancel?: (id: string) => void; onRefresh?: () => void; onDeliveryDesk?: () => void }) {
  const index = steps.indexOf(order.status);
  const next = steps[index + 1];
  const nextText = order.status === "confirmed" ? "Start preparing" : order.status === "preparing" ? "Mark ready" : "Mark collected";
  return <article className={"order-card" + (vendor ? " vendor-order" : "")}>
    <div className="order-card-header">
      <div><div className="order-number">#{order.token}</div><div className="order-meta">{modeName(order.category)}</div></div>
      <Status status={order.status} />
    </div>
    <div className="order-body">
      {vendor && <p className="customer-line"><Users size={14} />{order.name} · {order.customerType}</p>}
      {order.items.map((item, i) => <div className="order-item" key={i}><span>{item.quantity} × {item.name}</span><span>{money(item.unitPrice * item.quantity)}</span></div>)}
      {!vendor && order.status !== "cancelled" && order.status !== "refunded" && <div className="order-progress" aria-label={"Order status " + statusNames[order.status]}>
        {steps.map((step, i) => <div key={step} className={"progress-step" + (i <= index ? " done" : "")}><div className="progress-line" /><small>{step === "ready" ? "Ready" : statusNames[step]}</small></div>)}
      </div>}
      <div className="order-pickup"><Clock3 size={20} /><p>{order.pickupTime}<small>{formatDate(order.pickupDate)} · {order.fulfillment === "delivery" ? "Peer delivery" : order.category === "meal" ? "Preorder pickup lane" : "Express counter"}</small></p></div>
      {order.fulfillment === "delivery" && <p className="feature-note"><MapPin size={14} /> {locations.find(location => location.id === order.destination)?.name || order.destination} · {order.deliveryStatus?.replaceAll("_", " ") || "Waiting for ready food"}</p>}
      {order.status === "ready" && !vendor && <div className="order-ready-note"><PackageCheck size={16} />{order.fulfillment === "delivery" ? "Your food is ready for courier pickup." : "Your food is ready. Show your order number."}</div>}
      {!!order.discount && <div className="discount-line"><span>Approved student benefit</span><strong>−{money(order.discount)}</strong></div>}
      {!!order.walletUsed && <div className="quote-line"><span>Wallet credit used</span><span>{money(order.walletUsed)}</span></div>}
      <div className="order-payment"><span>{order.status === "refunded" ? "Test-paid balance credited to wallet" : <>Test paid <strong>{money(order.paid)}</strong></>}</span><span>{order.balance > 0 ? <>Balance <strong>{money(order.balance)}</strong></> : <>Total <strong>{money(order.total)}</strong></>}</span></div>
      {vendor && order.status !== "collected" && order.status !== "cancelled" && order.status !== "refunded" && <div className="vendor-order-actions">
        <button className="primary-button" disabled={busy} onClick={() => order.fulfillment === "delivery" && order.status === "ready" ? onDeliveryDesk?.() : next && onStatus?.(order.id, next)}>{busy ? <LoaderCircle size={16} className="loading-icon" /> : <Check size={15} />}{order.fulfillment === "delivery" && order.status === "ready" ? "Open delivery desk" : nextText}</button>
        <button className="secondary-button danger-button" disabled={busy} onClick={() => onStatus?.(order.id, "cancelled")}>Cancel</button>
      </div>}
      {!vendor && order.status === "confirmed" && <button className="order-cancel" disabled={busy} onClick={() => onCancel?.(order.id)}>{busy ? "Cancelling…" : "Cancel order"}</button>}
      {!vendor && order.fulfillment === "delivery" && <RecipientDeliveryPanel orderId={order.id} recipientCode={order.recipientCode} deliveryStatus={order.deliveryStatus} onRefresh={() => onRefresh?.()} />}
    </div>
  </article>;
}

function formatDate(date: string) {
  return new Date(date + "T12:00:00+05:30").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

type MenuChanges = Partial<Pick<MenuItem, "price" | "stock" | "available">>;

function MenuEditor({ item, onSave }: { item: MenuItem; onSave: (id: string, values: MenuChanges) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [price, setPrice] = useState(String(item.price));
  const [stock, setStock] = useState(String(item.stock));
  const [available, setAvailable] = useState(item.available);
  const dirty = useRef(new Set<keyof MenuChanges>());
  useEffect(() => {
    if (!dirty.current.has("price")) setPrice(String(item.price));
    if (!dirty.current.has("stock")) setStock(String(item.stock));
    if (!dirty.current.has("available")) setAvailable(item.available);
  }, [item.price, item.stock, item.available]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty.current.size) return;
    const changes: MenuChanges = {};
    if (dirty.current.has("price")) changes.price = Number(price);
    if (dirty.current.has("stock")) changes.stock = Number(stock);
    if (dirty.current.has("available")) changes.available = available;
    setBusy(true); setMessage(null);
    try {
      await onSave(item.id, changes);
      dirty.current.clear();
      setMessage({ text: "Menu updated" });
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : "Couldn’t save the item.", error: true }); }
    finally { setBusy(false); }
  }
  return <form className="vendor-menu-form" onSubmit={submit}>
    <img src={item.image} alt="" loading="lazy" />
    <div className="vendor-menu-fields">
      <div className="vendor-menu-title"><VegMark vegetarian={item.vegetarian} /><div><h3>{item.name}</h3><small>{item.category === "express" ? "Express" : "Day-ahead meal"}</small></div></div>
      <div className="form-row"><label className="form-field"><span>Price (₹)</span><input name="price" type="number" min="1" max="5000" step="1" required disabled={busy} value={price} onChange={event => { dirty.current.add("price"); setPrice(event.target.value); }} /></label><label className="form-field"><span>Stock left</span><input name="stock" type="number" min="0" max="10000" step="1" required disabled={busy} value={stock} onChange={event => { dirty.current.add("stock"); setStock(event.target.value); }} /></label></div>
      <div className="vendor-menu-controls"><label className="check-label"><input name="available" type="checkbox" checked={available} disabled={busy} onChange={event => { dirty.current.add("available"); setAvailable(event.target.checked); }} />Available</label><button className="secondary-button" disabled={busy || !dirty.current.size}>{busy ? "Saving…" : "Save changes"}</button></div>
      {message && <p className={message.error ? "error-message" : "save-state"} role="status">{message.text}</p>}
    </div>
  </form>;
}

function SlotEditor({ slot, onSave }: { slot: Slot; onSave: (id: string, capacity: number) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true); setMessage(null);
    try { await onSave(slot.id, Number(values.get("capacity"))); setMessage({ text: "Capacity updated" }); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : "Couldn’t save this slot.", error: true }); }
    finally { setBusy(false); }
  }
  return <form className="slot-form" onSubmit={submit}>
    <h3 className="slot-title">{slot.label || slot.time}</h3>
    <p className="slot-meta">{formatDate(slot.date)} · {slot.category === "express" ? "Express" : "Meal preorders"}</p>
    <div className="slot-usage"><span style={{ width: Math.min(100, slot.capacity ? slot.reserved / slot.capacity * 100 : 100) + "%" }} /></div>
    <small className="slot-meta">{slot.reserved} items reserved · {Math.max(0, slot.capacity - slot.reserved)} items available</small>
    <div className="slot-bottom"><label className="form-field"><span>Item capacity</span><input name="capacity" required type="number" min={slot.reserved} max="200" step="1" defaultValue={slot.capacity} /></label><button className="secondary-button" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    {message && <p className={message.error ? "error-message" : "save-state"} role="status">{message.text}</p>}
  </form>;
}

export default function LunchLine({ initial }: { initial: CatalogResponse }) {
  const [catalog, setCatalog] = useState(initial);
  const [view, setView] = useState<View>("menu");
  const [mode, setMode] = useState<Mode>("express");
  const [search, setSearch] = useState("");
  const [vegOnly, setVegOnly] = useState(false);
  const [foodGroup, setFoodGroup] = useState("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [name, setName] = useState(initial.user.name || "");
  const [customerType, setCustomerType] = useState<"student" | "faculty" | "staff">("student");
  const [slotId, setSlotId] = useState("");
  const [payment, setPayment] = useState<"full" | "deposit">("full");
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("pickup");
  const [destination, setDestination] = useState("");
  const [useWallet, setUseWallet] = useState(false);
  const [account, setAccount] = useState<AccountResponse | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [vendorOrders, setVendorOrders] = useState<Order[]>([]);
  const [vendorTab, setVendorTab] = useState<"queue" | "menu" | "slots" | "registry" | "delivery" | "google">("queue");
  const [queueFilter, setQueueFilter] = useState<"active" | Order["status"]>("active");
  const [busyId, setBusyId] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const [syncError, setSyncError] = useState("");
  const [ordersLoading, setOrdersLoading] = useState(true);
  const requestId = useRef<string | null>(null);
  const requestPayload = useRef<string | null>(null);
  const checkoutInProgress = useRef(false);
  const refreshVersion = useRef(0);
  const refreshInProgress = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (refreshInProgress.current && !force) return;
    refreshInProgress.current = true;
    const version = ++refreshVersion.current;
    const results = await Promise.allSettled([
      api<CatalogResponse>("/api/catalog"),
      api<{ orders: Order[] }>("/api/orders"),
      initial.user.isVendor ? api<{ orders: Order[] }>("/api/vendor/orders") : Promise.resolve({ orders: [] }),
      api<AccountResponse>("/api/account"),
    ]);
    if (version !== refreshVersion.current) return;
    refreshInProgress.current = false;
    if (results[0].status === "fulfilled") setCatalog(results[0].value as CatalogResponse);
    if (results[1].status === "fulfilled") setOrders((results[1].value as { orders: Order[] }).orders);
    if (results[2]?.status === "fulfilled") setVendorOrders((results[2].value as { orders: Order[] }).orders);
    if (results[3]?.status === "fulfilled") setAccount(results[3].value as AccountResponse);
    const failure = results.find(result => result.status === "rejected");
    setSyncError(failure?.status === "rejected" ? (failure.reason instanceof Error ? failure.reason.message : "Live updates are temporarily unavailable.") : "");
    setOrdersLoading(false);
  }, [initial.user.isVendor]);

  const refreshAccount = useCallback(async () => { await refresh(true); }, [refresh]);
  const linkedAccount = useCallback((linked: AccountResponse) => { setAccount(linked); void refresh(true); }, [refresh]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 8000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  useEffect(() => {
    if (!cartOpen) return;
    const previous = document.body.style.overflow;
    if (window.innerWidth <= 800) document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setCartOpen(false); };
    window.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", escape); };
  }, [cartOpen]);

  const cartDetails = cart.map(line => ({ ...line, item: catalog.menu.find(item => item.id === line.menuItemId) })).filter((line): line is CartLine & { item: MenuItem } => !!line.item);
  const cartMode = cartDetails[0]?.item.category || mode;
  const quantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = cartDetails.reduce((sum, line) => sum + line.quantity * line.item.price, 0);
  const dueNow = quote ? (cartMode === "meal" && payment === "deposit" ? quote.depositNow : quote.payNow) : total;
  const balanceAtPickup = quote ? Math.max(0, quote.total - quote.walletUsed - dueNow) : 0;
  const availableSlots = catalog.slots.filter(slot => slot.category === cartMode && slot.date === (cartMode === "express" ? catalog.today : catalog.tomorrow));
  const modeSlots = catalog.slots.filter(slot => slot.category === mode && slot.date === (mode === "express" ? catalog.today : catalog.tomorrow));
  const expressClosed = mode === "express" && !modeSlots.length;
  const expressFull = mode === "express" && modeSlots.length > 0 && !modeSlots.some(slot => slot.capacity > slot.reserved);
  const modeHasCapacity = modeSlots.some(slot => slot.capacity > slot.reserved);
  const selectedSlot = availableSlots.find(slot => slot.id === slotId) || availableSlots.find(slot => slot.capacity - slot.reserved >= quantity);
  const visibleMenu = useMemo(() => catalog.menu.filter(item => item.category === mode && (foodGroup === "all" || item.foodGroup === foodGroup) && (!vegOnly || item.vegetarian) && (item.name + " " + item.description).toLowerCase().includes(search.toLowerCase())), [catalog.menu, mode, foodGroup, vegOnly, search]);
  const foodGroups = [...new Set(catalog.menu.filter(item => item.category === mode).map(item => item.foodGroup).filter((group): group is NonNullable<MenuItem["foodGroup"]> => !!group))];
  const quoteRequest: QuoteRequest = { items: cart, slotId: selectedSlot?.id || "", fulfillment, destination: fulfillment === "delivery" ? destination : undefined, useWallet };
  const quoteRequestKey = JSON.stringify(quoteRequest);
  const cartPriceKey = cartDetails.map(line => line.item.id + ":" + line.item.price + ":" + line.item.available).join(",");

  useEffect(() => {
    setQuote(null); setQuoteError("");
    if (!cart.length || !selectedSlot || (fulfillment === "delivery" && !destination)) { setQuoteBusy(false); return; }
    const controller = new AbortController();
    setQuoteBusy(true);
    const timer = window.setTimeout(() => {
      void api<{ quote: Quote }>("/api/quote", { method: "POST", signal: controller.signal, body: quoteRequestKey })
        .then(data => { if (!controller.signal.aborted) setQuote(data.quote); })
        .catch(error => { if (!controller.signal.aborted) setQuoteError(error instanceof Error ? error.message : "Couldn’t calculate the order total."); })
        .finally(() => { if (!controller.signal.aborted) setQuoteBusy(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [quoteRequestKey, cartPriceKey, account?.wallet.balance, account?.discount.description]);
  const activeOrders = orders.filter(order => !["cancelled", "collected", "refunded"].includes(order.status)).length;
  const vendorActive = vendorOrders.filter(order => !["cancelled", "collected", "refunded"].includes(order.status));

  function updateQuantity(id: string, amount: number) {
    if (checkoutInProgress.current) return;
    if (amount > 0 && (quantity >= 20 || (cart.find(line => line.menuItemId === id)?.quantity || 0) >= 10)) return;
    requestId.current = null;
    setCheckoutError("");
    setCart(current => current.map(line => line.menuItemId === id ? { ...line, quantity: Math.max(0, line.quantity + amount) } : line).filter(line => line.quantity > 0));
  }

  function add(item: MenuItem) {
    if (checkoutInProgress.current) return;
    if (cartDetails.length && cartMode !== item.category) {
      setCheckoutError("Your basket contains " + (cartMode === "express" ? "express items" : "meal preorders") + ". Clear it to start a different order.");
      setCartOpen(true); return;
    }
    if (quantity >= 20 || (cart.find(line => line.menuItemId === item.id)?.quantity || 0) >= 10) {
      setCheckoutError("You can order up to 10 of each item and 20 items in total.");
      setCartOpen(true); return;
    }
    if (cart.some(line => line.menuItemId === item.id && line.quantity >= item.stock)) return;
    requestId.current = null;
    setCheckoutError("");
    setCart(current => current.some(line => line.menuItemId === item.id) ? current.map(line => line.menuItemId === item.id ? { ...line, quantity: line.quantity + 1 } : line) : [...current, { menuItemId: item.id, quantity: 1 }]);
    setCartOpen(true);
  }

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checkoutInProgress.current) return;
    setCheckoutError("");
    if (!cart.length || !selectedSlot) { setCheckoutError("Choose an available pickup slot to place your order."); return; }
    if (!quote || quoteBusy || quoteError) { setCheckoutError("Wait for a confirmed order quote before checking out."); return; }
    if (fulfillment === "delivery" && !destination) { setCheckoutError("Choose your campus drop-off location."); return; }
    if (selectedSlot.capacity - selectedSlot.reserved < quantity) { setCheckoutError("This slot doesn’t have enough room for your basket. Please choose another time."); return; }
    if (quantity > 20 || cart.some(line => line.quantity > 10)) { setCheckoutError("You can order up to 10 of each item and 20 items in total."); return; }
    checkoutInProgress.current = true; setCheckoutBusy(true);
    const payload = {
      name: name.trim(),
      customerType: account?.profile?.active ? account.profile.role : customerType,
      slotId: selectedSlot.id,
      paymentChoice: cartMode === "meal" ? payment : "full",
      items: cart,
      fulfillment,
      destination: fulfillment === "delivery" ? destination : undefined,
      useWallet,
      expectedTotal: quote.total,
      expectedDiscount: quote.discount,
      expectedWallet: quote.walletUsed,
    };
    const snapshot = JSON.stringify(payload);
    if (!requestId.current || requestPayload.current !== snapshot) {
      requestId.current = crypto.randomUUID();
      requestPayload.current = snapshot;
    }
    try {
      const result = await api<{ order: Order }>("/api/orders", { method: "POST", body: JSON.stringify({ requestId: requestId.current, ...payload }) });
      setOrders(current => [result.order, ...current.filter(order => order.id !== result.order.id)]);
      setCart([]); setCartOpen(false); setView("orders"); requestId.current = null;
      setMessage({ text: "Order #" + result.order.token + " is confirmed. Track it here until pickup." });
      void refresh(true);
    } catch (error) { setCheckoutError(error instanceof Error ? error.message : "Couldn’t place the order."); }
    finally { checkoutInProgress.current = false; setCheckoutBusy(false); }
  }

  async function cancelOrder(id: string) {
    setBusyId(id); setMessage(null);
    try {
      await api("/api/orders/" + encodeURIComponent(id) + "/cancel", { method: "POST", body: "{}" });
      await refresh(true); setMessage({ text: "Your order has been cancelled." });
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : "Couldn’t cancel the order.", error: true }); }
    finally { setBusyId(""); }
  }

  async function changeStatus(id: string, status: Order["status"]) {
    setBusyId(id); setMessage(null);
    try { await api("/api/vendor/orders/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify({ status }) }); await refresh(true); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : "Couldn’t update the order.", error: true }); }
    finally { setBusyId(""); }
  }

  async function saveMenu(id: string, values: MenuChanges) {
    await api("/api/vendor/menu/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(values) });
    await refresh(true);
  }
  async function saveSlot(id: string, capacity: number) {
    await api("/api/vendor/slots/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify({ capacity }) });
    await refresh(true);
  }

  const cartPanel = <aside className={"cart-panel" + (cartOpen ? " open" : "")} aria-label="Your order">
    <div className="cart-heading"><div><h2>Your order <span className="cart-mode">{quantity ? "(" + quantity + ")" : ""}</span></h2><p className="cart-mode">{cart.length ? modeName(cartMode) : "A good break starts here"}</p></div><button className="icon-button" onClick={() => setCartOpen(false)} aria-label="Close basket"><X size={21} /></button></div>
    {!cart.length ? <div className="cart-empty"><span className="cart-empty-icon"><ShoppingBag size={26} strokeWidth={1.4} /></span><h3>What are you craving?</h3><p>Add a little something from the menu. We’ll have it ready for your pickup.</p></div> :
      <form className="cart-content" onSubmit={checkout}>
        <div className="cart-lines">{cartDetails.map(line => <div className="cart-line" key={line.menuItemId}>
          <img src={line.item.image} alt="" /><div className="cart-line-info"><strong>{line.item.name}</strong><span>{money(line.item.price)}</span></div>
          <div className="quantity-control"><button type="button" aria-label={"Remove one " + line.item.name} disabled={checkoutBusy} onClick={() => updateQuantity(line.menuItemId, -1)}><Minus size={12} /></button><span>{line.quantity}</span><button type="button" aria-label={"Add one " + line.item.name} disabled={checkoutBusy || line.quantity >= line.item.stock || line.quantity >= 10 || quantity >= 20} onClick={() => updateQuantity(line.menuItemId, 1)}><Plus size={12} /></button></div>
        </div>)}</div>
        <p className="basket-limit">Up to 10 of each item · 20 items per order</p>
        <div className="cart-service-tabs" aria-label="Order handoff"><button type="button" className={fulfillment === "pickup" ? "active" : ""} disabled={checkoutBusy} onClick={() => { setFulfillment("pickup"); requestId.current = null; }}>Counter pickup</button><button type="button" className={fulfillment === "delivery" ? "active" : ""} disabled={checkoutBusy || cartDetails.some(line => line.item.foodGroup === "desserts")} onClick={() => { setFulfillment("delivery"); requestId.current = null; }}>Peer delivery</button></div>
        {cartDetails.some(line => line.item.foodGroup === "desserts") && <p className="basket-limit">Desserts use counter pickup.</p>}
        {fulfillment === "delivery" && <><label className="form-field"><span>Campus drop-off location</span><select required value={destination} disabled={checkoutBusy} onChange={event => { setDestination(event.target.value); requestId.current = null; }}><option value="">Choose a meeting point</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><p className="basket-limit">A student must accept your ready order. The 30-minute window starts at verified counter pickup. If no courier accepts, contact the counter for pickup or cancellation.</p></>}
        <label className="form-field"><span>Pickup time <small>· {formatDate(cartMode === "express" ? catalog.today : catalog.tomorrow)}</small></span><select value={selectedSlot?.id || ""} required disabled={checkoutBusy} onChange={event => { setSlotId(event.target.value); requestId.current = null; }}><option value="" disabled>Select a time</option>{availableSlots.map(slot => <option key={slot.id} value={slot.id} disabled={slot.capacity - slot.reserved < quantity}>{slot.label || slot.time}{slot.capacity - slot.reserved < quantity ? " · Not enough space" : " · " + (slot.capacity - slot.reserved) + " items left"}</option>)}</select></label>
        {!availableSlots.some(slot => slot.capacity - slot.reserved >= quantity) && <p className="error-message">No pickup slot has room for this basket. Reduce the quantity or check back with the canteen.</p>}
        <label className="form-field"><span>Your name</span><input autoComplete="name" required minLength={1} maxLength={60} value={name} disabled={checkoutBusy} onChange={event => { setName(event.target.value); requestId.current = null; }} placeholder="Name for pickup" /></label>
        {account?.profile?.active ? <p className="basket-limit">Registered campus role · {account.profile.role}</p> : <label className="form-field"><span>Role for this order</span><select value={customerType} disabled={checkoutBusy} onChange={event => { setCustomerType(event.target.value as typeof customerType); requestId.current = null; }}><option value="student">Student</option><option value="faculty">Faculty</option><option value="staff">Staff</option></select></label>}
        <p className="basket-limit">{account?.discount.description || "Student benefits require a linked college identity and approved registry record."}</p>
        {!!account?.wallet.balance && <label className="check-label wallet-check"><input type="checkbox" checked={useWallet} disabled={checkoutBusy} onChange={event => { setUseWallet(event.target.checked); requestId.current = null; }} />Use internal wallet · {money(account.wallet.balance)} available</label>}
        {cartMode === "meal" && <fieldset className="payment-options"><legend>Test payment</legend><label className="payment-option"><input type="radio" name="payment" checked={payment === "full"} disabled={checkoutBusy} onChange={() => { setPayment("full"); requestId.current = null; }} />Pay in full {quote ? "· " + money(quote.payNow) : ""}</label><label className="payment-option"><input type="radio" name="payment" checked={payment === "deposit"} disabled={checkoutBusy} onChange={() => { setPayment("deposit"); requestId.current = null; }} />50% deposit {quote ? "· " + money(quote.depositNow) : ""}</label></fieldset>}
        <div className="quote-lines"><div className="quote-line"><span>Food subtotal</span><span>{money(quote?.subtotal ?? total)}</span></div>{!!quote?.discount && <div className="discount-line"><span>{quote.discountDescription}</span><strong>−{money(quote.discount)}</strong></div>}{fulfillment === "delivery" && <div className="quote-line"><span>Peer delivery fee</span><span>{quote ? money(quote.deliveryFee) : "Select destination"}</span></div>}{!!quote?.walletUsed && <div className="quote-line"><span>Wallet credit</span><span>−{money(quote.walletUsed)}</span></div>}</div>
        <div className="cart-total"><span>{balanceAtPickup > 0 ? "Pay now" : "Test checkout total"}</span><span>{quoteBusy ? "…" : money(dueNow)}</span></div>
        {balanceAtPickup > 0 && <div className="cart-balance"><span>Balance at {fulfillment === "delivery" ? "handoff" : "pickup"}</span><span>{money(balanceAtPickup)}</span></div>}
        {quoteError && <p className="error-message" role="alert">{quoteError}</p>}
        {checkoutError && <p className="error-message" role="alert">{checkoutError}</p>}
        <button className="primary-button wide" disabled={checkoutBusy || quoteBusy || !quote || !!quoteError || !availableSlots.some(slot => slot.capacity - slot.reserved >= quantity)}>{checkoutBusy ? <><LoaderCircle size={17} className="loading-icon" />Placing order…</> : quoteBusy ? <><LoaderCircle size={17} className="loading-icon" />Calculating total…</> : <>Place test order <ShoppingBag size={16} /></>}</button>
        <p className="payment-notice"><ShieldCheck size={12} />Test checkout · No money collected</p>
        <button type="button" className="cart-clear" disabled={checkoutBusy} onClick={() => { setCart([]); setCheckoutError(""); requestId.current = null; }}>Clear basket</button>
      </form>}
  </aside>;

  return <>
    <div className="pilot-notice"><ShieldCheck size={14} /><span><strong>Private NITC campus pilot</strong> · Test payments only. Confirm pickup arrangements with your canteen.</span></div>
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" onClick={event => { event.preventDefault(); setView("menu"); }}><span className="brand-mark"><UtensilsCrossed size={23} strokeWidth={1.8} /></span>lunchline<span className="brand-period">.</span></a>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={"nav-button" + (view === "menu" ? " active" : "")} onClick={() => setView("menu")}><UtensilsCrossed size={16} />Menu</button>
          <button className={"nav-button" + (view === "orders" ? " active" : "")} onClick={() => { setView("orders"); void refresh(); }}><ReceiptText size={16} />My orders{activeOrders > 0 && <span className="nav-count">{activeOrders}</span>}</button>
          <button className={"nav-button" + (view === "campus" ? " active" : "")} onClick={() => setView("campus")}><Bike size={17} />Campus & delivery</button>
          <button className={"nav-button" + (view === "account" ? " active" : "")} onClick={() => { setView("account"); void refresh(); }}><Wallet size={17} />Account & wallet</button>
          {catalog.user.isVendor && <button className={"nav-button" + (view === "vendor" ? " active" : "")} onClick={() => { setView("vendor"); void refresh(); }}><ChefHat size={17} />Vendor</button>}
        </nav>
        <div className="header-campus"><MapPin size={17} /><div><strong>NIT Calicut</strong><small>East Campus pilot</small></div></div>
        {quantity > 0 && <button className="header-basket" aria-label={"Open basket with " + quantity + " items"} onClick={() => { setView("menu"); setCartOpen(true); }}><ShoppingBag size={18} /><span>{quantity}</span></button>}
      </header>
      {syncError && <div className="global-message error" role="alert"><Clock3 size={18} /><span>{syncError}</span><button className="secondary-button" onClick={() => void refresh(true)}>Retry</button></div>}
      {message && <div className={"global-message" + (message.error ? " error" : "")} role={message.error ? "alert" : "status"}>{message.error ? <Clock3 size={18} /> : <CheckCircle2 size={18} />}<span>{message.text}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setMessage(null)}><X size={17} /></button></div>}
      {view === "menu" && <>
        <section className="hero">
          <div className="hero-copy"><div className="hero-eyebrow"><Leaf size={14} />Your campus, freshly served</div><h1>Good food.<br /><span>Less waiting.</span></h1><p>A quick bite between classes, or tomorrow’s lunch sorted. Order ahead and own your break.</p><div className="hero-meta"><span><Clock3 size={15} />Pick your pickup time</span><span><UtensilsCrossed size={15} />Made at your canteen</span></div></div>
          <div className="hero-photo"><img src={catalog.menu.find(item => item.category === "meal")?.image || catalog.menu[0]?.image} alt="Fresh food prepared for your next campus lunch" /><div className="hero-photo-caption"><span><Leaf size={19} /></span><div><p>A proper lunch. A little more time.</p><small>Meal preorders open for tomorrow</small></div></div></div>
        </section>
        <div className="catalog-layout"><main className="menu-main">
          <div className="mode-tabs" role="tablist" aria-label="Order type">
            <button role="tab" aria-selected={mode === "express"} className={"mode-tab" + (mode === "express" ? " active" : "")} onClick={() => { setMode("express"); setSearch(""); setFoodGroup("all"); }}><Coffee size={23} /><span><strong>Today’s menu</strong><small>Food & quick bites</small></span></button>
            <button role="tab" aria-selected={mode === "meal"} className={"mode-tab" + (mode === "meal" ? " active" : "")} onClick={() => { setMode("meal"); setSearch(""); setFoodGroup("all"); }}><UtensilsCrossed size={22} /><span><strong>Tomorrow’s meals</strong><small>Book a day ahead</small></span></button>
          </div>
          <p className="mode-description">{mode === "express" ? "Prepared meals, biryani and quick bites. Choose today’s pickup or a campus delivery." : "Full meals, planned ahead. Reserve tomorrow’s pickup with full payment or a 50% deposit."}</p>
          <div className="menu-toolbar"><label className="search-field"><Search size={17} /><input type="search" aria-label="Search the menu" placeholder="Search the menu…" value={search} onChange={event => setSearch(event.target.value)} /></label><button className={"filter-toggle" + (vegOnly ? " active" : "")} aria-pressed={vegOnly} onClick={() => setVegOnly(!vegOnly)}><VegMark vegetarian />Veg only{vegOnly && <Check size={13} />}</button></div>
          {foodGroups.length > 1 && <div className="food-groups" aria-label="Food category"><button className={foodGroup === "all" ? "active" : ""} onClick={() => setFoodGroup("all")}>All food</button>{foodGroups.map(group => <button key={group} className={foodGroup === group ? "active" : ""} onClick={() => setFoodGroup(group)}>{groupNames[group]}</button>)}</div>}
          {(expressClosed || expressFull) && <div className="closed-menu-notice"><Clock3 size={22} /><div><h3>{expressClosed ? "Today’s pickup window is closed" : "Today’s pickup slots are full"}</h3><p>Browse today’s food below, or plan a meal for tomorrow.</p></div><button className="secondary-button" onClick={() => { setMode("meal"); setSearch(""); setFoodGroup("all"); }}>See tomorrow’s meals</button></div>}
          <div className="section-heading"><h2>{mode === "express" ? "Today’s food" : "Lunch, planned ahead"}</h2><small>{visibleMenu.length} items</small></div>
          <div className="menu-grid">{visibleMenu.map(item => <article className={"food-card" + (!item.available || item.stock === 0 ? " unavailable" : "")} key={item.id}>
            <div className="food-photo"><img src={item.image} alt={item.name} loading="lazy" /><span className="food-label"><VegMark vegetarian={item.vegetarian} />{item.vegetarian ? "Veg" : "Non-veg"}</span>{(!item.available || item.stock === 0) && <span className="sold-out-label">{item.stock === 0 ? "Sold out for now" : "Currently unavailable"}</span>}</div>
            <div className="food-info"><span className="food-category">{item.foodGroup ? groupNames[item.foodGroup] : item.category === "express" ? "Ready today" : "Day-ahead meal"}</span><h3>{item.name}</h3><p>{item.description}</p><div className="food-card-bottom"><span className="price">{money(item.price)}</span><button className="add-button" onClick={() => add(item)} disabled={!item.available || item.stock === 0 || !modeHasCapacity || checkoutBusy || quantity >= 20 || (cart.find(line => line.menuItemId === item.id)?.quantity || 0) >= Math.min(item.stock, 10)} aria-label={"Add " + item.name}>{modeHasCapacity && <Plus size={14} />}{modeHasCapacity ? "Add" : expressClosed ? "Closed" : "Full"}</button></div></div>
          </article>)}
          {visibleMenu.length === 0 && <div className="empty-state"><Search size={30} /><h3>No matching dishes</h3><p>Try a different search or reset the food filters.</p><button className="secondary-button" style={{ marginTop: 18 }} onClick={() => { setSearch(""); setVegOnly(false); setFoodGroup("all"); }}>Reset filters</button></div>}
          {mode === "meal" && !modeHasCapacity && <p className="error-message menu-capacity" role="status">Tomorrow’s pickup slots are currently full. Check back with the canteen for more availability.</p>}</div>
        </main>{cartPanel}</div>
      </>}
      {view === "orders" && <main className="orders-page">
        <div className="page-intro"><div><h1>My orders</h1><p>Your next good break, from kitchen to pickup.</p></div><button className="secondary-button" onClick={() => setView("menu")}><Plus size={15} />New order</button></div>
        {ordersLoading ? <div className="empty-state"><LoaderCircle size={30} className="loading-icon" /><p>Loading your orders…</p></div> : orders.length ? <div className="orders-grid">{orders.map(order => <OrderCard key={order.id} order={order} busy={busyId === order.id} onCancel={cancelOrder} onRefresh={() => void refresh(true)} />)}</div> : <div className="empty-state"><ReceiptText size={36} /><h3>Your first order is waiting</h3><p>Pick something from the menu and follow its progress here.</p><button className="primary-button" style={{ margin: "22px auto 0" }} onClick={() => setView("menu")}>Explore the menu</button></div>}
      </main>}
      {view === "campus" && <CampusDeliveryPanel onAccountRefresh={refreshAccount} />}
      {view === "account" && <AccountWalletPanel account={account} onLinked={linkedAccount} onRefresh={refreshAccount} onBrowse={() => setView("menu")} />}
      {view === "vendor" && catalog.user.isVendor && <main className="vendor-page">
        <div className="page-intro"><div><h1>Canteen desk</h1><p>Keep the kitchen moving and every pickup on time.</p></div><span className="status-label"><span className="live-dot" />Live pilot</span></div>
        <div className="vendor-stats"><div className="stat"><span>Active orders</span><strong>{vendorActive.length}</strong><small>In the current queue</small></div><div className="stat"><span>Preparing</span><strong>{vendorOrders.filter(order => order.status === "preparing").length}</strong><small>With the kitchen</small></div><div className="stat"><span>Ready for pickup</span><strong>{vendorOrders.filter(order => order.status === "ready").length}</strong><small>Waiting to collect</small></div><div className="stat"><span>Collected</span><strong>{vendorOrders.filter(order => order.status === "collected").length}</strong><small>Completed orders</small></div></div>
        <div className="vendor-tabs"><button className={vendorTab === "queue" ? "active" : ""} onClick={() => setVendorTab("queue")}>Order queue</button><button className={vendorTab === "menu" ? "active" : ""} onClick={() => setVendorTab("menu")}>Manage menu</button><button className={vendorTab === "slots" ? "active" : ""} onClick={() => setVendorTab("slots")}>Pickup slots</button><button className={vendorTab === "registry" ? "active" : ""} onClick={() => setVendorTab("registry")}>Student registry</button><button className={vendorTab === "delivery" ? "active" : ""} onClick={() => setVendorTab("delivery")}>Delivery desk & disputes</button><button className={vendorTab === "google" ? "active" : ""} onClick={() => setVendorTab("google")}>Google setup</button></div>
        {vendorTab === "queue" && <><div className="vendor-queue-header"><h2>{queueFilter === "active" ? "Orders to prepare & hand over" : statusNames[queueFilter] + " orders"}</h2><div className="queue-filter">{(["active", "confirmed", "preparing", "ready", "collected", "cancelled", "refunded"] as const).map(filter => <button key={filter} className={queueFilter === filter ? "active" : ""} onClick={() => setQueueFilter(filter)}>{filter === "active" ? "Active" : filter === "ready" ? "Ready" : statusNames[filter]}</button>)}</div></div><div className="queue-grid">{vendorOrders.filter(order => queueFilter === "active" ? !["collected", "cancelled", "refunded"].includes(order.status) : order.status === queueFilter).map(order => <OrderCard order={order} key={order.id} vendor busy={busyId === order.id} onStatus={changeStatus} onDeliveryDesk={() => setVendorTab("delivery")} />)}{!vendorOrders.some(order => queueFilter === "active" ? !["collected", "cancelled", "refunded"].includes(order.status) : order.status === queueFilter) && <div className="empty-state"><ChefHat size={34} /><h3>You’re all caught up</h3><p>Orders will appear here as customers place them.</p></div>}</div></>}
        {vendorTab === "menu" && <div className="vendor-menu-grid">{catalog.menu.map(item => <MenuEditor key={item.id} item={item} onSave={saveMenu} />)}</div>}
        {vendorTab === "slots" && <><p className="mode-description">Set capacity in item units to match what the kitchen can prepare. Existing reservations count toward each slot.</p><div className="slot-grid">{catalog.slots.map(slot => <SlotEditor key={slot.id} slot={slot} onSave={saveSlot} />)}</div></>}
        {vendorTab === "registry" && <RegistryPanel />}
        {vendorTab === "delivery" && <DeliveryDeskPanel />}
        {vendorTab === "google" && <GoogleSetupPanel />}
      </main>}
      <footer className="footer"><span className="brand"><span className="brand-mark"><UtensilsCrossed size={16} /></span>lunchline.</span><span>Made for better campus breaks.</span><a href="/photo-credits">Photo credits</a><span>Private pilot · Test payments</span></footer>
    </div>
    {view !== "menu" && cartOpen && <div className="off-menu-cart">{cartPanel}</div>}
    {cartOpen && <button className="cart-backdrop visible" aria-label="Close basket" onClick={() => setCartOpen(false)} />}
    {quantity > 0 && <button className="mobile-cart-bar" onClick={() => { setCartOpen(true); }}><strong><ShoppingBag size={18} />View order <span>({quantity} {quantity === 1 ? "item" : "items"})</span></strong><span className="cart-total-price">{money(total)}</span></button>}
  </>;
}





