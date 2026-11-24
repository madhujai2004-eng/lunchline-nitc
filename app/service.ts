import type { Category, MenuItem, Order, Slot, Status } from './types';
import { calculateQuote, handleFeatureApi, initializeFeatures } from './features';
import { deliveryCode, expireDeliveries, handleDeliveryApi } from './delivery';

interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, any>>(): Promise<T | null>;
  all<T = Record<string, any>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}
export interface User { id: string; email: string; name: string; isVendor: boolean }
const initialMenu: MenuItem[] = [
  { id: 'veg-puff', name: 'Golden veg puff', description: 'Flaky pastry with a spiced vegetable filling.', category: 'express', vegetarian: true, price: 30, stock: 30, available: true, image: '/food/veg-puff.jpg' },
  { id: 'lime-drink', name: 'Fresh lime cooler', description: 'Lime, chilled water and a little sweetness.', category: 'express', vegetarian: true, price: 25, stock: 40, available: true, image: '/food/lime-drink.jpg' },
  { id: 'overnight-oats', name: 'Berry overnight oats', description: 'Oats, milk, fruit and seeds. Prepared for quick pickup.', category: 'express', vegetarian: true, price: 65, stock: 20, available: true, image: '/food/overnight-oats.jpg' },
  { id: 'protein-bites', name: 'Peanut energy bites', description: 'A snack-sized portion of oats, dates and peanuts.', category: 'express', vegetarian: true, price: 45, stock: 25, available: true, image: '/food/protein-bites.jpg' },
  { id: 'veg-bowl', name: 'Garden rice bowl', description: 'Rice, chickpeas, seasonal vegetables and a bright dressing.', category: 'meal', vegetarian: true, price: 110, stock: 40, available: true, image: '/food/veg-meal-bowl.jpg' },
  { id: 'chicken-bowl', name: 'Grilled chicken bowl', description: 'Chicken, rice and vegetables, made for your lunch slot.', category: 'meal', vegetarian: false, price: 150, stock: 40, available: true, image: '/food/chicken-rice-bowl.jpg' },
  { id: 'chicken-biryani', name: 'Malabar chicken biryani', description: 'Prepared rice, spiced chicken and raita. One meal portion.',category:'express',vegetarian:false,price:140,stock:30,available:true,image:'/food/chicken-biryani.jpg',foodGroup:'biryani',mealEligible:true },
  { id: 'veg-biryani', name: 'Vegetable biryani', description: 'Fragrant rice with vegetables and raita. One meal portion.',category:'express',vegetarian:true,price:100,stock:30,available:true,image:'/food/veg-biryani.jpg',foodGroup:'biryani',mealEligible:true },
  { id: 'south-meal', name: 'South Indian veg meals', description:'Rice, sambar, seasonal sides and curd. One meal portion.',category:'express',vegetarian:true,price:80,stock:30,available:true,image:'/food/south-indian-meals.jpg',foodGroup:'meals',mealEligible:true },
  { id: 'samosa',name:'Vegetable samosa',description:'Crisp pastry with a potato and pea filling.',category:'express',vegetarian:true,price:20,stock:40,available:true,image:'/food/samosa.jpg',foodGroup:'snacks' },
  { id: 'ice-cream',name:'Vanilla ice cream cup',description:'A small frozen treat. Collect at the counter.',category:'express',vegetarian:true,price:40,stock:25,available:true,image:'/food/ice-cream.jpg',foodGroup:'desserts' },
  { id: 'chicken-biryani-preorder',name:'Tomorrow’s chicken biryani',description:'Reserve a chicken biryani meal for tomorrow’s pickup slot.',category:'meal',vegetarian:false,price:140,stock:30,available:true,image:'/food/chicken-biryani.jpg',foodGroup:'biryani',mealEligible:true },
  { id: 'veg-biryani-preorder',name:'Tomorrow’s vegetable biryani',description:'Reserve a vegetable biryani meal for tomorrow’s pickup slot.',category:'meal',vegetarian:true,price:100,stock:30,available:true,image:'/food/veg-biryani.jpg',foodGroup:'biryani',mealEligible:true },
  { id:'veg-meals-preorder',name:'Tomorrow’s veg meals',description:'A planned South Indian lunch with rice, sambar, sides and curd.',category:'meal',vegetarian:true,price:80,stock:30,available:true,image:'/food/south-indian-meals.jpg',foodGroup:'meals',mealEligible:true },
];
const times = {
  express: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:45', '12:00', '12:15', '12:30', '12:45', '13:00', '13:15', '13:30', '13:45', '14:00', '14:15'],
  meal: ['11:45', '12:00', '12:15', '12:30', '12:45', '13:00', '13:15', '13:30', '13:45', '14:00', '14:15'],
};
export function campusClock(now: Date) {
  const iso = new Date(now.getTime() + 330 * 60_000).toISOString();
  return { today: iso.slice(0, 10), tomorrow: new Date(now.getTime() + (330 + 1440) * 60_000).toISOString().slice(0, 10), time: iso.slice(11, 16) };
}
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
function fail(message: string, status = 400): never { throw { message, status, expected: true }; }
function integer(value: unknown, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail(`Enter a whole number between ${min} and ${max}.`);
  return value;
}
async function body(request: Request): Promise<Record<string, any>> {
  const value = await request.json().catch(() => fail('Invalid request body.'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid request body.');
  return value as Record<string, any>;
}
async function bootstrap(db: Database, now: Date) {
  const clock = campusClock(now);
  const statements = initialMenu.map(m => db.prepare('INSERT OR IGNORE INTO menu (id,name,description,category,vegetarian,price,stock,available,image,food_group,meal_eligible) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(m.id,m.name,m.description,m.category,Number(m.vegetarian),m.price,m.stock,Number(m.available),m.image,m.foodGroup??(m.category==='meal'?'meals':m.id==='lime-drink'?'drinks':'snacks'),Number(m.mealEligible??m.category==='meal')));
  statements.push(db.prepare("UPDATE menu SET meal_eligible=1,food_group='meals' WHERE category='meal' AND meal_eligible=0"));
  statements.push(db.prepare("UPDATE menu SET food_group='drinks' WHERE id='lime-drink' AND food_group='snacks'"));
  for (const category of ['express', 'meal'] as Category[]) {
    const date = category === 'express' ? clock.today : clock.tomorrow;
    for (const time of times[category]) {
      const [h, m] = time.split(':').map(Number);
      const label = `${h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
      statements.push(db.prepare('INSERT OR IGNORE INTO slots (id,date,time,label,category,capacity,reserved) VALUES (?,?,?,?,?,20,0)').bind(`${date}-${category}-${time}`,date,time,label,category));
    }
  }
  await db.batch(statements);
  return clock;
}
async function listOrders(db: Database, user: User, all = false, orderId?: string) {
  const conditions = [!all ? 'o.user_id=?' : '', orderId ? 'o.id=?' : ''].filter(Boolean);
  const values = [...(!all ? [user.id] : []), ...(orderId ? [orderId] : [])];
  const sql = `SELECT o.*, s.date AS pickup_date, s.label AS pickup_time,d.status AS delivery_status FROM orders o JOIN slots s ON o.slot_id=s.id LEFT JOIN deliveries d ON d.order_id=o.id ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY o.created_at DESC LIMIT 200`;
  const records = await db.prepare(sql).bind(...values).all();
  const ids = records.results.map(r => r.id);
  const items: Record<string, any>[] = [];
  for (let offset=0; offset<ids.length; offset+=100) {
    const batchIds = ids.slice(offset,offset+100);
    const batch = await db.prepare(`SELECT * FROM order_items WHERE order_id IN (${batchIds.map(() => '?').join(',')})`).bind(...batchIds).all();
    items.push(...batch.results);
  }
  return Promise.all(records.results.map(async(r): Promise<Order> => ({ id:r.id, token:r.token, name:r.name, customerType:r.customer_type, status:r.delivery_status==='failed'?'refunded':r.status, category:r.category, slotId:r.slot_id, pickupDate:r.pickup_date, pickupTime:r.pickup_time, total:r.total, paid:r.paid, balance:r.status === 'cancelled'||r.delivery_status==='failed' ? 0 : Math.round((r.total-r.paid)*100)/100, paymentChoice:r.payment_choice, createdAt:r.created_at, subtotal:r.subtotal_paise?r.subtotal_paise/100:r.total,discount:r.discount_paise/100,discountKind:r.discount_kind,deliveryFee:r.delivery_fee_paise/100,walletUsed:r.wallet_used_paise/100,fulfillment:r.fulfillment,destination:r.dropoff_location,deliveryStatus:r.delivery_status,recipientCode:!all&&['picked_up','review_hold'].includes(r.delivery_status)?await deliveryCode(db,r.id,'recipient'):undefined,items:items.filter(i => i.order_id===r.id).map(i=>({name:i.name,quantity:i.quantity,unitPrice:i.unit_price})) })));
}
async function existingOrder(db: Database, user: User, requestId: string, fingerprint: string) {
  const found = await db.prepare('SELECT id,fingerprint FROM orders WHERE user_id=? AND request_id=?').bind(user.id,requestId).first();
  if (!found) return null;
  if (found.fingerprint !== fingerprint) fail('This checkout reference was already used. Please start a new checkout.',409);
  return (await listOrders(db,user,false,found.id))[0] ?? null;
}

export async function handleApi(request: Request, db: Database, user: User | null, now = new Date()): Promise<Response> {
  try {
    if (!user) fail('Sign in to use LunchLine.',401);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/,'');
    if (request.method !== 'GET') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) fail('Request origin is not allowed.',403);
      if (request.headers.get('Sec-Fetch-Site') === 'cross-site') fail('Request origin is not allowed.',403);
    }
    if (path.startsWith('/api/vendor') && !user.isVendor) fail('Vendor access is required.',403);
    const clock = await bootstrap(db,now);
    await initializeFeatures(db);
    await expireDeliveries(db,now);
    const featureResponse=await handleFeatureApi(request,db,user,now);
    if(featureResponse) return featureResponse;
    const deliveryResponse=await handleDeliveryApi(request,db,user,now);
    if(deliveryResponse) return deliveryResponse;
    if (path === '/api/catalog' && request.method === 'GET') {
      const menu = (await db.prepare('SELECT * FROM menu ORDER BY category DESC, price ASC').all()).results.map(m=>({...m,vegetarian:Boolean(m.vegetarian),available:Boolean(m.available),foodGroup:m.food_group,mealEligible:!!m.meal_eligible||m.category==='meal'}));
      const slots = (await db.prepare('SELECT * FROM slots WHERE (date=? AND category=\'express\' AND time>?) OR (date=? AND category=\'meal\') ORDER BY date,time').bind(clock.today,clock.time,clock.tomorrow).all()).results;
      return json({ user:{name:user.name,email:user.email,isVendor:user.isVendor}, today:clock.today,tomorrow:clock.tomorrow,menu,slots,paymentMode:'test' });
    }
    if (path === '/api/orders' && request.method === 'GET') return json({orders:await listOrders(db,user)});
    if (path === '/api/vendor/orders' && request.method === 'GET') return json({orders:await listOrders(db,user,true)});
    if ((path === '/api/orders'||path==='/api/quote') && request.method === 'POST') {
      const data = await body(request);
      const quoteOnly=path==='/api/quote';
      if (!quoteOnly) {
        if (typeof data.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(data.requestId)) fail('A valid checkout reference is required.');
        if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 60) fail('Enter a name of 1–60 characters.');
        if (!['student','faculty','staff'].includes(data.customerType)) fail('Choose your campus role.');
        if (!['full','deposit'].includes(data.paymentChoice)) fail('Choose a payment option.');
      }
      if (!Array.isArray(data.items) || data.items.length<1 || data.items.length>20) fail('Add between 1 and 20 menu items.');
      const unique = new Set<string>();
      const lines = data.items.map((i: any)=> {
        if (!i || typeof i.menuItemId !== 'string' || unique.has(i.menuItemId)) fail('Each menu item can appear once in an order.');
        unique.add(i.menuItemId);
        return {menuItemId:i.menuItemId,quantity:integer(i.quantity,1,10)};
      }).sort((a:any,b:any)=>a.menuItemId.localeCompare(b.menuItemId));
      const extended=data.fulfillment!==undefined||data.destination!==undefined||data.useWallet!==undefined;
      const fingerprint = JSON.stringify({name:data.name?.trim(),customerType:data.customerType,slotId:data.slotId,paymentChoice:data.paymentChoice,items:lines,...(extended?{fulfillment:data.fulfillment??'pickup',destination:data.destination??null,useWallet:data.useWallet??false}:{}),...('expectedTotal' in data?{expectedTotal:data.expectedTotal,expectedDiscount:data.expectedDiscount,expectedWallet:data.expectedWallet}:{})});
      if(!quoteOnly) {
        const replay = await existingOrder(db,user,data.requestId,fingerprint);
        if (replay) return json({order:replay});
        const held=await db.prepare("SELECT id FROM incidents WHERE courier_user_id=? AND status='fined'").bind(user.id).first();
        if(held) fail('Resolve your reviewed delivery fine in Account & wallet before placing another order.',403);
      }
      const slot = await db.prepare('SELECT * FROM slots WHERE id=?').bind(data.slotId??'').first();
      if (!slot || (slot.category==='express' && (slot.date!==clock.today || slot.time<=clock.time)) || (slot.category==='meal' && slot.date!==clock.tomorrow)) fail('Choose an available pickup slot.');
      if (slot.category==='express' && data.paymentChoice==='deposit') fail('Express orders use full test payment.');
      const units = lines.reduce((sum:number,i:any)=>sum+i.quantity,0);
      if (units>20) fail('Order up to 20 items at a time.');
      const items: Array<Record<string, any> & {quantity:number}> = [];
      for (const line of lines) {
        const item = await db.prepare('SELECT * FROM menu WHERE id=?').bind(line.menuItemId).first();
        if (!item || !item.available || item.category!==slot.category || item.stock<line.quantity) fail('An item is unavailable or the quantity exceeds current stock.',409);
        items.push({...item,quantity:line.quantity});
      }
      if(data.fulfillment==='delivery' && items.some(i=>i.food_group==='desserts')) fail('Frozen desserts are pickup only so they stay frozen.');
      const cost=await calculateQuote(db,user,items,slot,data,now);
      if(quoteOnly) return json({quote:cost.quote});
      for(const [field,amount] of [['expectedTotal',cost.total],['expectedDiscount',cost.discount],['expectedWallet',cost.wallet]] as const) {
        if(field in data && (typeof data[field]!=='number'||!Number.isFinite(data[field])||Math.round(data[field]*100)!==amount)) fail('Your price, student benefit or wallet changed. Review the refreshed total before ordering.',409);
      }
      const total=cost.total/100;
      const upfront=data.paymentChoice==='deposit'?Math.ceil((cost.total-cost.wallet)/2):cost.total-cost.wallet;
      const paid=(upfront+cost.wallet)/100;
      const id = crypto.randomUUID();
      const statements = [db.prepare('INSERT INTO orders (id,token,user_id,request_id,fingerprint,name,customer_type,status,category,slot_id,units,total,paid,payment_choice,created_at,subtotal_paise,discount_paise,discount_kind,discount_basis_paise,student_id,discount_date,fulfillment,dropoff_location,delivery_fee_paise,wallet_used_paise) VALUES (?,?,?,?,?,?,?,\'confirmed\',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,`LL-${id.slice(0,6).toUpperCase()}`,user.id,data.requestId,fingerprint,data.name.trim(),data.customerType,slot.category,slot.id,units,total,paid,data.paymentChoice,now.toISOString(),cost.subtotal,cost.discount,cost.kind,cost.basis,cost.studentId,slot.date,cost.fulfillment,cost.destination,cost.fee,cost.wallet)];
      for (const item of items) statements.push(db.prepare('INSERT INTO order_items (id,order_id,menu_item_id,name,quantity,unit_price) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),id,item.id,item.name,item.quantity,item.price));
      if(cost.kind==='day_scholar') statements.push(db.prepare("INSERT INTO discount_claims (order_id,student_id,pickup_date,status) VALUES (?,?,?,'reserved')").bind(id,cost.studentId,slot.date));
      if(cost.wallet) statements.push(db.prepare("INSERT INTO wallet_entries (id,user_id,source_id,kind,amount_paise,created_at) VALUES (?,?,?,'spend',?,?)").bind(crypto.randomUUID(),user.id,id,-cost.wallet,now.toISOString()));
      if(cost.fulfillment==='delivery') statements.push(db.prepare("INSERT INTO deliveries (order_id,status,fee_paise,destination,attempts) VALUES (?,'open',?,?,0)").bind(id,cost.fee,cost.destination));
      try { await db.batch(statements); }
      catch (error) {
        const replay = await existingOrder(db,user,data.requestId,fingerprint);
        if (replay) return json({order:replay});
        fail('Stock, slot capacity, daily discount or wallet balance changed. Refresh the order and try again.',409);
      }
      return json({order:(await listOrders(db,user,false,id))[0]},201);
    }
    const cancel = path.match(/^\/api\/orders\/([^/]+)\/cancel$/);
    if (cancel && request.method === 'POST') {
      const found = await db.prepare('SELECT status FROM orders WHERE id=? AND user_id=?').bind(cancel[1],user.id).first();
      if (!found) fail('Order not found.',404);
      if (found.status !== 'confirmed' && found.status !== 'cancelled') fail('This order is already being prepared. Contact the counter.',409);
      await db.prepare('UPDATE orders SET status=\'cancelled\',paid=0 WHERE id=? AND user_id=? AND status=\'confirmed\'').bind(cancel[1],user.id).run();
      const order = (await listOrders(db,user,false,cancel[1]))[0];
      if (order?.status!=='cancelled') fail('The vendor has started preparing this order.',409);
      return json({order});
    }
    const vendorOrder = path.match(/^\/api\/vendor\/orders\/([^/]+)$/);
    if (vendorOrder && request.method === 'PATCH') {
      const data = await body(request);
      const found = await db.prepare('SELECT o.status,o.fulfillment,d.status AS delivery_status,d.picked_up_at FROM orders o LEFT JOIN deliveries d ON d.order_id=o.id WHERE o.id=?').bind(vendorOrder[1]).first();
      if (!found) fail('Order not found.',404);
      if(data.status==='collected'&&found.fulfillment==='delivery'&&found.delivery_status!=='delivered') fail('The recipient must confirm delivery before this order can be completed.',409);
      if(data.status==='cancelled'&&found.picked_up_at!=null) fail('The courier has collected this order. Open a delivery review instead of cancelling it.',409);
      const next: Record<string,string[]> = {confirmed:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['collected','cancelled'],collected:[],cancelled:[]};
      if (data.status!==found.status && !next[found.status]?.includes(data.status)) fail('This status transition is not available.',409);
      await db.prepare('UPDATE orders SET status=?,paid=CASE WHEN ?=\'collected\' THEN total WHEN ?=\'cancelled\' THEN 0 ELSE paid END WHERE id=? AND status=?').bind(data.status,data.status,data.status,vendorOrder[1],found.status).run();
      const order = (await listOrders(db,user,true,vendorOrder[1]))[0];
      if (order?.status!==data.status) fail('The order changed. Refresh and try again.',409);
      return json({order});
    }
    const vendorMenu = path.match(/^\/api\/vendor\/menu\/([^/]+)$/);
    if (vendorMenu && request.method === 'PATCH') {
      const data = await body(request);
      const assignments:string[] = []; const values:unknown[]=[];
      if ('price' in data) { assignments.push('price=?'); values.push(integer(data.price,1,5000)); }
      if ('stock' in data) { assignments.push('stock=?'); values.push(integer(data.stock,0,10000)); }
      if ('available' in data) { if(typeof data.available!=='boolean') fail('Availability must be true or false.'); assignments.push('available=?'); values.push(Number(data.available)); }
      if (!assignments.length) fail('Change a price, stock or availability.');
      const found = await db.prepare('SELECT id FROM menu WHERE id=?').bind(vendorMenu[1]).first();
      if (!found) fail('Menu item not found.',404);
      await db.prepare(`UPDATE menu SET ${assignments.join(',')} WHERE id=?`).bind(...values,vendorMenu[1]).run();
      return json({ok:true});
    }
    const vendorSlot = path.match(/^\/api\/vendor\/slots\/([^/]+)$/);
    if (vendorSlot && request.method === 'PATCH') {
      const data = await body(request); const capacity = integer(data.capacity,0,200);
      const found = await db.prepare('SELECT reserved FROM slots WHERE id=?').bind(vendorSlot[1]).first();
      if (!found) fail('Slot not found.',404);
      if (capacity<found.reserved) fail('Capacity must cover items already reserved.',409);
      await db.prepare('UPDATE slots SET capacity=? WHERE id=? AND reserved<=?').bind(capacity,vendorSlot[1],capacity).run();
      const saved = await db.prepare('SELECT capacity FROM slots WHERE id=?').bind(vendorSlot[1]).first();
      if (saved?.capacity!==capacity) fail('New reservations arrived. Refresh the slot.',409);
      return json({ok:true});
    }
    return json({error:'Route not found.'},404);
  } catch (error: any) {
    if (error?.expected) return json({error:error.message},error.status);
    if(/custody|Recipient delivery confirmation|cannot be cancelled/i.test(String(error?.message))) return json({error:'The delivery has changed. Check its handoff status before continuing.'},409);
    console.error('LunchLine request failed', error?.message);
    return json({error:'LunchLine could not complete this request. Please try again.'},500);
  }
}
