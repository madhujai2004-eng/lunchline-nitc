import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { SqliteD1 } from './sqlite-d1.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const { handleApi } = await import(pathToFileURL(path.join(project, 'app/service.ts')));
const now = new Date('2026-11-24T01:00:00.000Z');
const customer = { id: 'qa-student', email: 'student@example.edu', name: 'QA Student', isVendor: false };
const otherCustomer = { id: 'qa-other', email: 'other@example.edu', name: 'Other Student', isVendor: false };
const vendor = { id: 'qa-vendor', email: 'vendor@example.edu', name: 'QA Vendor', isVendor: true };
export { call, setup, checkout, place, assertCreated, now, customer, otherCustomer, vendor };

async function call(db, pathname, options = {}) {
  const { user = customer, method = 'GET', body, origin = 'https://lunchline.test', at = now } = options;
  const headers = new Headers();
  if (origin) headers.set('origin', origin);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const request = new Request(`https://lunchline.test/api${pathname}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await handleApi(request, db, user, at);
  const data = await response.json();
  return { status: response.status, data };
}

async function setup() {
  const db = new SqliteD1();
  const migrationDirectory = path.join(project, 'drizzle');
  const files = (await fs.readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) await db.exec(await fs.readFile(path.join(migrationDirectory, file), 'utf8'));
  if (!db.database.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='wallet_entry_guard'").get()) {
    await db.exec(await fs.readFile(path.join(project, 'db/extension-invariants.sql'), 'utf8'));
  }
  const walletGuard = db.database.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='wallet_entry_guard'").get();
  if (!walletGuard.sql.includes("'compensation'")) {
    await db.exec(await fs.readFile(path.join(project, 'db/refund-invariants.sql'), 'utf8'));
  }
  const response = await call(db, '/catalog');
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.paymentMode, 'test');
  const item = response.data.menu.find((entry) => entry.category === 'express' && entry.available && entry.stock > 0);
  const slot = response.data.slots.find((entry) => entry.category === 'express' && entry.date === response.data.today);
  assert.ok(item && slot, 'Catalog must supply an item and a current-day pickup slot');
  return { db, catalog: response.data, item, slot };
}

function checkout(item, slot, extra = {}) {
  return {
    requestId: crypto.randomUUID(), name: 'QA Student', customerType: 'student', slotId: slot.id,
    paymentChoice: 'full', items: [{ menuItemId: item.id, quantity: 1 }], ...extra,
  };
}

async function place(context, extra = {}, options = {}) {
  return call(context.db, '/orders', { method: 'POST', body: checkout(context.item, context.slot, extra), ...options });
}

function assertCreated(response) {
  assert.ok([200, 201].includes(response.status), JSON.stringify(response));
  assert.ok(response.data.order?.id);
  return response.data.order;
}

test('identity, vendor access and order ownership', async () => {
  const context = await setup();
  try {
    assert.equal((await call(context.db, '/orders', { user: null })).status, 401);
    assert.equal((await call(context.db, '/vendor/orders')).status, 403);
    assert.equal((await call(context.db, `/vendor/menu/${context.item.id}`, {
      method: 'PATCH', body: { price: 1, stock: 999, available: true },
    })).status, 403);
    const order = assertCreated(await place(context));
    const others = await call(context.db, '/orders', { user: otherCustomer });
    assert.equal(others.status, 200);
    assert.ok(!others.data.orders.some((entry) => entry.id === order.id));
    assert.ok([403, 404].includes((await call(context.db, `/orders/${order.id}/cancel`, {
      method: 'POST', body: {}, user: otherCustomer,
    })).status));
    const vendorOrders = await call(context.db, '/vendor/orders', { user: vendor });
    assert.equal(vendorOrders.status, 200);
    assert.ok(vendorOrders.data.orders.some((entry) => entry.id === order.id));
  } finally { context.db.close(); }
});

test('malformed inputs, unknown resources and foreign origins are rejected', async () => {
  const context = await setup();
  try {
    const invalid = [
      { items: [] }, { items: [{ menuItemId: context.item.id, quantity: -1 }] },
      { items: [{ menuItemId: context.item.id, quantity: 0 }] },
      { items: [{ menuItemId: context.item.id, quantity: 1.5 }] },
      { items: [{ menuItemId: context.item.id, quantity: '2' }] },
      { items: [{ menuItemId: 'missing', quantity: 1 }] },
      { paymentChoice: 'free' }, { customerType: 'vendor' },
      { requestId: '' }, { slotId: 'missing' }, { slotId: {} }, { slotId: [] }, { slotId: 7 }, { name: '' },
    ];
    for (const extra of invalid) {
      const result = await place(context, extra);
      assert.ok([400, 404, 409, 422].includes(result.status), JSON.stringify({ extra, result }));
    }
    assert.equal((await place(context, {}, { origin: 'https://unrelated.test' })).status, 403);
    assert.equal((await call(context.db, `/vendor/slots/${context.slot.id}`, {
      user: vendor, method: 'PATCH', body: { capacity: -1 },
    })).status, 400);
    assert.equal((await call(context.db, `/vendor/menu/${context.item.id}`, {
      user: vendor, method: 'PATCH', body: { price: -1, stock: 1, available: true },
    })).status, 400);
  } finally { context.db.close(); }
});

test('checkout retries use one customer-scoped idempotency key', async () => {
  const context = await setup();
  try {
    const body = checkout(context.item, context.slot);
    const results = await Promise.all(Array.from({ length: 6 }, () => call(context.db, '/orders', { method: 'POST', body })));
    const ids = results.map(assertCreated).map((order) => order.id);
    assert.equal(new Set(ids).size, 1);
    const orders = await call(context.db, '/orders');
    assert.equal(orders.data.orders.length, 1);
    const mismatch = await call(context.db, '/orders', {
      method: 'POST', body: { ...body, items: [{ menuItemId: context.item.id, quantity: 2 }] },
    });
    assert.equal(mismatch.status, 409, JSON.stringify(mismatch));
    const other = assertCreated(await call(context.db, '/orders', { method: 'POST', body, user: otherCustomer }));
    assert.notEqual(other.id, ids[0]);
  } finally { context.db.close(); }
});

test('atomic reservations prevent overselling stock and slot capacity', async () => {
  for (const limits of [{ stock: 2, capacity: 8, expected: 2 }, { stock: 8, capacity: 2, expected: 2 }]) {
    const context = await setup();
    try {
      const stock = await call(context.db, `/vendor/menu/${context.item.id}`, {
        user: vendor, method: 'PATCH', body: { price: context.item.price, stock: limits.stock, available: true },
      });
      assert.equal(stock.status, 200, JSON.stringify(stock));
      const capacity = await call(context.db, `/vendor/slots/${context.slot.id}`, {
        user: vendor, method: 'PATCH', body: { capacity: limits.capacity },
      });
      assert.equal(capacity.status, 200, JSON.stringify(capacity));
      const results = await Promise.all(Array.from({ length: 8 }, () => place(context)));
      const successes = results.filter((result) => [200, 201].includes(result.status));
      assert.equal(successes.length, limits.expected, JSON.stringify(results));
      for (const failure of results.filter((result) => ![200, 201].includes(result.status))) {
        assert.equal(failure.status, 409, JSON.stringify(failure));
      }
      assert.equal((await context.db.prepare('SELECT stock FROM menu WHERE id=?').bind(context.item.id).first()).stock, limits.stock - limits.expected);
      assert.equal((await context.db.prepare('SELECT reserved FROM slots WHERE id=?').bind(context.slot.id).first()).reserved, limits.expected);
    } finally { context.db.close(); }
  }
});

test('cancellation refunds and releases inventory once', async () => {
  const context = await setup();
  try {
    await call(context.db, `/vendor/menu/${context.item.id}`, {
      user: vendor, method: 'PATCH', body: { price: context.item.price, stock: 1, available: true },
    });
    await call(context.db, `/vendor/slots/${context.slot.id}`, {
      user: vendor, method: 'PATCH', body: { capacity: 1 },
    });
    const order = assertCreated(await place(context));
    const cancels = await Promise.all(Array.from({ length: 4 }, () => call(context.db, `/orders/${order.id}/cancel`, {
      method: 'POST', body: {},
    })));
    for (const response of cancels) assert.ok([200, 409].includes(response.status), JSON.stringify(response));
    const second = assertCreated(await place(context));
    assert.notEqual(second.id, order.id);
    const exhausted = await place(context);
    assert.equal(exhausted.status, 409, JSON.stringify(exhausted));
    assert.equal((await context.db.prepare('SELECT stock FROM menu WHERE id=?').bind(context.item.id).first()).stock, 0);
    assert.equal((await context.db.prepare('SELECT reserved FROM slots WHERE id=?').bind(context.slot.id).first()).reserved, 1);
  } finally { context.db.close(); }
});

test('IST local dates cross midnight without a UTC date leak', async () => {
  const context = await setup();
  try {
    const before = await call(context.db, '/catalog', { at: new Date('2026-11-24T18:29:59.000Z') });
    const after = await call(context.db, '/catalog', { at: new Date('2026-11-24T18:30:00.000Z') });
    assert.equal(before.data.today, '2026-11-24');
    assert.equal(before.data.tomorrow, '2026-11-25');
    assert.equal(after.data.today, '2026-11-25');
    assert.equal(after.data.tomorrow, '2026-11-26');
    const expired = await place(context, {}, { at: new Date('2026-11-24T18:29:59.000Z') });
    assert.ok([400, 409].includes(expired.status), JSON.stringify(expired));
  } finally { context.db.close(); }
});

test('canonical server prices, test deposits and vendor status transitions', async () => {
  const context = await setup();
  try {
    const meal = context.catalog.menu.find((entry) => entry.category === 'meal' && entry.available && entry.stock > 0);
    const mealSlot = context.catalog.slots.find((entry) => entry.category === 'meal' && entry.date === context.catalog.tomorrow);
    assert.ok(meal && mealSlot);
    const order = assertCreated(await place(context, {
      slotId: mealSlot.id, paymentChoice: 'deposit', total: 1, paid: 1, balance: 0,
      status: 'collected', userId: otherCustomer.id,
      items: [{ menuItemId: meal.id, quantity: 1, price: 1, unitPrice: 1 }],
    }));
    assert.equal(order.total, meal.price);
    assert.equal(order.paid, Math.ceil(meal.price / 2));
    assert.equal(order.balance, meal.price - order.paid);
    assert.equal(order.status, 'confirmed');
    assert.equal(order.items[0].unitPrice, meal.price);
    const patch = (status) => call(context.db, `/vendor/orders/${order.id}`, {
      method: 'PATCH', user: vendor, body: { status },
    });
    assert.equal((await patch('collected')).status, 409);
    assert.equal((await patch('preparing')).status, 200);
    assert.equal((await call(context.db, `/orders/${order.id}/cancel`, { method: 'POST', body: {} })).status, 409);
    assert.equal((await patch('confirmed')).status, 409);
    assert.equal((await patch('ready')).status, 200);
    assert.equal((await patch('collected')).status, 200);
    const collected = await call(context.db, '/orders');
    const final = collected.data.orders.find((entry) => entry.id === order.id);
    assert.equal(final.paid, meal.price);
    assert.equal(final.balance, 0);
    assert.equal((await patch('cancelled')).status, 409);
  } finally { context.db.close(); }
});

test('multi-item capacity uses item units and cancellation restores the full quantity', async () => {
  const context = await setup();
  try {
    await call(context.db, `/vendor/slots/${context.slot.id}`, {
      user: vendor, method: 'PATCH', body: { capacity: 2 },
    });
    const rejected = await place(context, { items: [{ menuItemId: context.item.id, quantity: 3 }] });
    assert.equal(rejected.status, 409);
    assert.equal((await context.db.prepare('SELECT reserved FROM slots WHERE id=?').bind(context.slot.id).first()).reserved, 0);
    assert.equal((await context.db.prepare('SELECT stock FROM menu WHERE id=?').bind(context.item.id).first()).stock, context.item.stock);
    const order = assertCreated(await place(context, { items: [{ menuItemId: context.item.id, quantity: 2 }] }));
    assert.equal((await context.db.prepare('SELECT reserved FROM slots WHERE id=?').bind(context.slot.id).first()).reserved, 2);
    assert.equal((await call(context.db, `/vendor/slots/${context.slot.id}`, {
      user: vendor, method: 'PATCH', body: { capacity: 1 },
    })).status, 409);
    await call(context.db, `/orders/${order.id}/cancel`, { method: 'POST', body: {} });
    assert.equal((await context.db.prepare('SELECT reserved FROM slots WHERE id=?').bind(context.slot.id).first()).reserved, 0);
    assert.equal((await context.db.prepare('SELECT stock FROM menu WHERE id=?').bind(context.item.id).first()).stock, context.item.stock);
  } finally { context.db.close(); }
});

test('a stock change between preflight and commit rolls back the entire order', async () => {
  const context = await setup();
  try {
    const second = context.catalog.menu.find((entry) => entry.id !== context.item.id && entry.category === 'express');
    const baseBatch = context.db.batch.bind(context.db);
    let changed = false;
    context.db.batch = async (statements) => {
      if (!changed && statements.some((statement) => statement.sql.startsWith('INSERT INTO orders'))) {
        context.db.database.prepare('UPDATE menu SET stock=0 WHERE id=?').run(second.id);
        changed = true;
      }
      return baseBatch(statements);
    };
    const result = await place(context, {
      items: [{ menuItemId: context.item.id, quantity: 1 }, { menuItemId: second.id, quantity: 1 }],
    });
    assert.equal(result.status, 409, JSON.stringify(result));
    assert.equal((await context.db.prepare('SELECT COUNT(*) AS count FROM orders').first()).count, 0);
    assert.equal((await context.db.prepare('SELECT COUNT(*) AS count FROM order_items').first()).count, 0);
    assert.equal((await context.db.prepare('SELECT reserved FROM slots WHERE id=?').bind(context.slot.id).first()).reserved, 0);
    assert.equal((await context.db.prepare('SELECT stock FROM menu WHERE id=?').bind(context.item.id).first()).stock, context.item.stock);
  } finally { context.db.close(); }
});

test('old order replays and status updates remain available beyond the 200-row listing limit', async () => {
  const context = await setup();
  try {
    const body = checkout(context.item, context.slot);
    const original = assertCreated(await call(context.db, '/orders', { method: 'POST', body }));
    for (let index = 1; index <= 201; index++) {
      const at = new Date(now.getTime() + index * 1000);
      const next = assertCreated(await place(context, {}, { at }));
      assert.equal((await call(context.db, `/orders/${next.id}/cancel`, { method: 'POST', body: {}, at })).status, 200);
    }
    const listing = await call(context.db, '/orders');
    assert.equal(listing.status, 200, JSON.stringify(listing));
    assert.equal(listing.data.orders.length, 200);
    const replay = assertCreated(await call(context.db, '/orders', { method: 'POST', body }));
    assert.equal(replay.id, original.id);
    const updated = await call(context.db, `/vendor/orders/${original.id}`, {
      user: vendor, method: 'PATCH', body: { status: 'preparing' },
    });
    assert.equal(updated.status, 200, JSON.stringify(updated));
    assert.equal(updated.data.order.id, original.id);
  } finally { context.db.close(); }
});
