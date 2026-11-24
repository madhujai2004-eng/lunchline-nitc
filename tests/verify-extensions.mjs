import assert from 'node:assert/strict';
import { test } from 'node:test';
import { call, setup, checkout, place, assertCreated, now, customer, otherCustomer, vendor } from './verify.mjs';
import { deliveryCode, counterCode, walletBalance } from '../app/delivery.ts';
import { deliveryFeePaise } from '../app/features.ts';

const courier = { id: 'courier-one', email: 'courier@example.test', name: 'Student Courier', isVendor: false };
const secondCourier = { id: 'courier-two', email: 'courier2@example.test', name: 'Other Courier', isVendor: false };
const minute = 60_000;

async function register(db, user, options = {}) {
  const email = `${user.id}@nitc.ac.in`;
  await db.prepare(`INSERT INTO identities (user_id,google_sub,email,verified_at) VALUES (?,?,?,?)`).bind(user.id, `google-${user.id}`, email, now.toISOString()).run();
  await db.prepare(`INSERT INTO registry (email,student_id,role,residence,need_approved,active,expires_on)
    VALUES (?,?,?,?,?,?,?)`).bind(email, `ID-${user.id.toUpperCase()}`, options.role ?? 'student', options.residence ?? 'hostel',
    Number(options.needApproved ?? false), Number(options.active ?? true), options.expiresOn ?? '2026-12-31').run();
}

async function attendance(db, user, at = now) {
  const result = await call(db, '/deliveries/presence', {
    user, method: 'POST', body: { code: await counterCode(db, at) }, at,
  });
  assert.equal(result.status, 200, JSON.stringify(result));
}

async function deliveryOrder(context, options = {}) {
  const { user = customer, ready = true, ...extra } = options;
  const order = assertCreated(await place(context, { fulfillment: 'delivery', destination: 'eclhc', ...extra }, { user }));
  if (ready) {
    for (const status of ['preparing', 'ready']) {
      const update = await call(context.db, `/vendor/orders/${order.id}`, { user: vendor, method: 'PATCH', body: { status } });
      assert.equal(update.status, 200, JSON.stringify(update));
    }
  }
  return order;
}

async function claim(db, order, user = courier, at = now) {
  return call(db, `/deliveries/${order.id}/claim`, { user, method: 'POST', body: {}, at });
}

async function pickup(db, order, user = courier, at = now) {
  return call(db, `/deliveries/${order.id}/pickup`, {
    user, method: 'POST', body: { code: await deliveryCode(db, order.id, 'pickup', at) }, at,
  });
}

async function confirm(db, order, user = customer, at = now) {
  return call(db, `/deliveries/${order.id}/confirm`, {
    user, method: 'POST', body: { code: await deliveryCode(db, order.id, 'recipient', at) }, at,
  });
}

test('delivery fee bands use the food subtotal', () => {
  for (const [food, fee] of [[1, 1000], [5000, 1000], [5001, 1500], [10000, 1500],
    [10001, 2000], [20000, 2000], [20001, 2500], [30000, 2500], [30001, 3000], [40000, 3000], [40001, 3500]]) {
    assert.equal(deliveryFeePaise(food), fee);
  }
});

test('Google activation is pending and roster changes require vendor authorization', async () => {
  const { db } = await setup();
  try {
    assert.equal((await call(db, '/google/nonce', { method: 'POST', body: {} })).status, 503);
    assert.equal((await call(db, '/vendor/registry')).status, 403);
    const record = { email: 'first@nitc.ac.in', studentId: 'B260001', role: 'student', residence: 'hostel', needApproved: true, active: true, expiresOn: '2026-12-31' };
    assert.equal((await call(db, '/vendor/registry', { user: vendor, method: 'POST', body: record })).status, 200);
    assert.equal((await call(db, '/vendor/registry', { user: vendor, method: 'POST', body: { ...record, email: 'second@nitc.ac.in' } })).status, 409);
    const unlinked = await call(db, '/account');
    assert.equal(unlinked.data.google.linked, false);
    assert.equal(unlinked.data.canDeliver, false);
    assert.equal(unlinked.data.discount.kind, 'none');
  } finally { db.close(); }
});

test('hostel discount applies to every food order with server-approved identity', async () => {
  const context = await setup();
  try {
    await register(context.db, customer, { needApproved: true });
    const first = assertCreated(await place(context));
    const second = assertCreated(await place(context));
    assert.equal(first.discountKind, 'hostel');
    assert.equal(first.discount, context.item.price * 0.1);
    assert.equal(second.discount, first.discount);
    assert.equal((await context.db.prepare('SELECT COUNT(*) AS count FROM discount_claims').first()).count, 0);
    const faculty = { ...otherCustomer, id: 'faculty' };
    await register(context.db, faculty, { role: 'faculty', needApproved: true, residence: 'hostel' });
    const spoof = assertCreated(await place(context, { customerType: 'student', discount: 100, discountKind: 'hostel' }, { user: faculty }));
    assert.equal(spoof.discount, 0);
  } finally { context.db.close(); }
});

test('day scholar receives one meal-unit discount per pickup day and cancellation releases it', async () => {
  const context = await setup();
  try {
    await register(context.db, customer, { needApproved: true, residence: 'day_scholar' });
    const meal = context.catalog.menu.find((item) => item.mealEligible);
    const slot = context.catalog.slots.find((entry) => entry.category === meal.category);
    const order = assertCreated(await place(context, { slotId: slot.id, items: [{ menuItemId: meal.id, quantity: 2 }] }));
    assert.equal(order.discountKind, 'day_scholar');
    assert.equal(order.discount, Math.round(meal.price * 100 * 0.25) / 100);
    const regular = assertCreated(await place(context, { slotId: slot.id, items: [{ menuItemId: meal.id, quantity: 1 }] }));
    assert.equal(regular.discount, 0);
    assert.equal((await call(context.db, `/orders/${order.id}/cancel`, { method: 'POST', body: {} })).status, 200);
    const replacement = assertCreated(await place(context, { slotId: slot.id, items: [{ menuItemId: meal.id, quantity: 1 }] }));
    assert.equal(replacement.discountKind, 'day_scholar');
    for (const status of ['preparing', 'ready', 'collected']) {
      assert.equal((await call(context.db, `/vendor/orders/${replacement.id}`, { user: vendor, method: 'PATCH', body: { status } })).status, 200);
    }
    assert.equal((await context.db.prepare('SELECT status FROM discount_claims WHERE order_id=?').bind(replacement.id).first()).status, 'used');
    const later = assertCreated(await place(context, { slotId: slot.id, items: [{ menuItemId: meal.id, quantity: 1 }] }));
    assert.equal(later.discount, 0);
  } finally { context.db.close(); }
});

test('simultaneous day scholar checkouts reserve at most one daily meal discount', async () => {
  const context = await setup();
  try {
    await register(context.db, customer, { needApproved: true, residence: 'day_scholar' });
    const meal = context.catalog.menu.find((item) => item.mealEligible);
    const slot = context.catalog.slots.find((entry) => entry.category === meal.category);
    const results = await Promise.all(Array.from({ length: 8 }, () => place(context, {
      slotId: slot.id, items: [{ menuItemId: meal.id, quantity: 1 }],
    })));
    const successful = results.filter((result) => [200, 201].includes(result.status));
    assert.equal(successful.filter((result) => result.data.order.discountKind === 'day_scholar').length, 1);
    assert.equal((await context.db.prepare("SELECT COUNT(*) AS count FROM discount_claims WHERE status<>'released'").first()).count, 1);
  } finally { context.db.close(); }
});

test('courier enrollment, counter presence, ownership and current service date are enforced', async () => {
  const context = await setup();
  try {
    const order = await deliveryOrder(context);
    assert.equal((await claim(context.db, order)).status, 403);
    await register(context.db, courier);
    assert.equal((await claim(context.db, order)).status, 403);
    assert.equal((await call(context.db, '/deliveries/presence', { user: courier, method: 'POST', body: { code: 'wrong' } })).status, 400);
    await attendance(context.db, courier);
    assert.equal((await claim(context.db, order)).status, 200);
    await register(context.db, secondCourier);
    await attendance(context.db, secondCourier);
    assert.equal((await claim(context.db, order, secondCourier)).status, 409);
    const self = await deliveryOrder(context, { user: courier });
    assert.equal((await claim(context.db, self)).status, 409);
    const tomorrowMeal = context.catalog.menu.find((item) => item.category === 'meal');
    const tomorrowSlot = context.catalog.slots.find((slot) => slot.category === 'meal');
    const tomorrow = await deliveryOrder(context, { slotId: tomorrowSlot.id, items: [{ menuItemId: tomorrowMeal.id, quantity: 1 }] });
    assert.equal((await claim(context.db, tomorrow)).status, 409);
    const board = await call(context.db, '/deliveries', { user: secondCourier });
    assert.ok(!board.data.deliveries.some((delivery) => delivery.orderId === tomorrow.id));
  } finally { context.db.close(); }
});

test('six concurrent claims stop at five active deliveries and expired claims reopen', async () => {
  const context = await setup();
  try {
    await register(context.db, courier);
    await attendance(context.db, courier);
    const orders = [];
    for (let index = 0; index < 6; index++) orders.push(await deliveryOrder(context));
    const results = await Promise.all(orders.map((order) => claim(context.db, order)));
    assert.equal(results.filter((result) => result.status === 200).length, 5);
    assert.equal((await context.db.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE courier_user_id=? AND status='claimed'").bind(courier.id).first()).count, 5);
    const expiredAt = new Date(now.getTime() + 5 * minute);
    const board = await call(context.db, '/deliveries', { user: courier, at: expiredAt });
    assert.equal(board.status, 200);
    assert.equal((await context.db.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE status='claimed'").first()).count, 0);
    assert.equal((await context.db.prepare('SELECT COUNT(*) AS count FROM incidents').first()).count, 0);
  } finally { context.db.close(); }
});

test('receipt confirmation is recipient-only and earns the courier once', async () => {
  const context = await setup();
  try {
    await register(context.db, courier);
    await attendance(context.db, courier);
    const order = await deliveryOrder(context);
    assert.equal((await claim(context.db, order)).status, 200);
    const before = await call(context.db, '/deliveries', { user: customer });
    assert.equal(before.data.deliveries.find((row) => row.orderId === order.id).recipientCode, undefined);
    const vendorBoard = await call(context.db, '/vendor/deliveries', { user: vendor });
    assert.equal(vendorBoard.data.deliveries.find((row) => row.orderId === order.id).pickupCode, await deliveryCode(context.db, order.id, 'pickup'));
    assert.equal((await pickup(context.db, order)).status, 200);
    const courierBoard = await call(context.db, '/deliveries', { user: courier });
    assert.equal(courierBoard.data.deliveries.find((row) => row.orderId === order.id).recipientCode, undefined);
    assert.equal((await confirm(context.db, order, courier)).status, 403);
    assert.equal((await confirm(context.db, order, otherCustomer)).status, 403);
    assert.equal(await walletBalance(context.db, courier.id), 0);
    const results = await Promise.all(Array.from({ length: 5 }, () => confirm(context.db, order)));
    assert.ok(results.every((result) => result.status === 200), JSON.stringify(results));
    assert.equal((await context.db.prepare("SELECT COUNT(*) AS count FROM wallet_entries WHERE source_id=? AND kind='earning'").bind(order.id).first()).count, 1);
    assert.equal(await walletBalance(context.db, courier.id), order.deliveryFee * 100);
    assert.equal((await context.db.prepare('SELECT status FROM orders WHERE id=?').bind(order.id).first()).status, 'collected');
  } finally { context.db.close(); }
});

test('physical custody blocks cancellation and vendor completion bypass', async () => {
  const context = await setup();
  try {
    await register(context.db, courier);
    await attendance(context.db, courier);
    const order = await deliveryOrder(context);
    const direct = await call(context.db, `/vendor/orders/${order.id}`, { user: vendor, method: 'PATCH', body: { status: 'collected' } });
    assert.ok([400, 409].includes(direct.status), JSON.stringify(direct));
    assert.equal((await claim(context.db, order)).status, 200);
    assert.equal((await pickup(context.db, order)).status, 200);
    const cancel = await call(context.db, `/vendor/orders/${order.id}`, { user: vendor, method: 'PATCH', body: { status: 'cancelled' } });
    assert.ok([400, 409].includes(cancel.status), JSON.stringify(cancel));
    assert.equal((await context.db.prepare('SELECT status FROM orders WHERE id=?').bind(order.id).first()).status, 'ready');
    assert.equal((await context.db.prepare('SELECT stock FROM menu WHERE id=?').bind(context.item.id).first()).stock, context.item.stock - 1);
  } finally { context.db.close(); }
});

test('deadline expiry creates a review hold without a fine and late receipt clears the open incident', async () => {
  const context = await setup();
  try {
    await register(context.db, courier);
    await attendance(context.db, courier);
    const order = await deliveryOrder(context);
    await claim(context.db, order);
    await pickup(context.db, order);
    const late = new Date(now.getTime() + 30 * minute + 1);
    const board = await call(context.db, '/deliveries', { user: courier, at: late });
    assert.equal(board.data.deliveries.find((row) => row.orderId === order.id).status, 'review_hold');
    assert.equal(board.data.canDeliver, false);
    assert.equal(board.data.incidents[0].status, 'open');
    assert.equal(board.data.incidents[0].fine, 0);
    assert.equal(await walletBalance(context.db, courier.id), 0);
    assert.equal((await confirm(context.db, order, customer, late)).status, 200);
    assert.equal((await context.db.prepare('SELECT status FROM incidents WHERE order_id=?').bind(order.id).first()).status, 'cleared');
    assert.equal(await walletBalance(context.db, courier.id), order.deliveryFee * 100);
  } finally { context.db.close(); }
});

test('reviewed fine is bounded, test settlement is idempotent, and wallet receives no topup', async () => {
  const context = await setup();
  try {
    await register(context.db, courier);
    await attendance(context.db, courier);
    const order = await deliveryOrder(context);
    await claim(context.db, order);
    await pickup(context.db, order);
    const report = await call(context.db, `/deliveries/${order.id}/report`, { user: courier, method: 'POST', body: { reason: 'Recipient requested counter review.' } });
    assert.equal(report.status, 200);
    const incident = report.data.incidents[0];
    const review = (fine) => call(context.db, `/vendor/incidents/${incident.id}`, { user: vendor, method: 'PATCH', body: { action: 'fine', fine, reason: 'Verified by counter staff after speaking to both parties.' } });
    assert.equal((await review(order.subtotal + 1)).status, 400);
    assert.equal((await review(10)).status, 200);
    assert.equal((await confirm(context.db, order)).status, 409);
    const before = await walletBalance(context.db, courier.id);
    assert.equal((await call(context.db, `/incidents/${incident.id}/repay`, { user: otherCustomer, method: 'POST', body: {} })).status, 404);
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.equal((await call(context.db, `/incidents/${incident.id}/repay`, { user: courier, method: 'POST', body: {} })).status, 200);
    }
    assert.equal(await walletBalance(context.db, courier.id), before);
    assert.equal((await confirm(context.db, order)).status, 200);
  } finally { context.db.close(); }
});

test('wallet funds are reserved atomically and cancellation refunds once', async () => {
  const context = await setup();
  try {
    await register(context.db, courier);
    await attendance(context.db, courier);
    const delivery = await deliveryOrder(context);
    await claim(context.db, delivery);
    await pickup(context.db, delivery);
    await confirm(context.db, delivery);
    const available = await walletBalance(context.db, courier.id);
    const attempts = await Promise.all(Array.from({ length: 4 }, () => place(context, { useWallet: true }, { user: courier })));
    const successful = attempts.filter((result) => [200, 201].includes(result.status));
    const spent = successful.reduce((sum, result) => sum + result.data.order.walletUsed * 100, 0);
    assert.ok(spent <= available);
    assert.equal(await walletBalance(context.db, courier.id), available - spent);
    const order = successful.find((result) => result.data.order.walletUsed > 0).data.order;
    const cancel = () => call(context.db, `/orders/${order.id}/cancel`, { user: courier, method: 'POST', body: {} });
    assert.ok((await Promise.all([cancel(), cancel(), cancel()])).every((result) => result.status === 200));
    assert.equal((await context.db.prepare("SELECT COUNT(*) AS count FROM wallet_entries WHERE source_id=? AND kind='refund'").bind(order.id).first()).count, 1);
    assert.equal(await walletBalance(context.db, courier.id), available);
    await assert.rejects(context.db.prepare("INSERT INTO wallet_entries (id,user_id,source_id,kind,amount_paise,created_at) VALUES ('forged',?,'forged','earning',100000,?)").bind(courier.id, now.toISOString()).run());
  } finally { context.db.close(); }
});

test('presence hides open work until verified and rate limits wrong counter codes', async () => {
  const context = await setup();
  try {
    await register(context.db, courier);
    const order = await deliveryOrder(context);
    const hidden = await call(context.db, '/deliveries', { user: courier });
    assert.ok(!hidden.data.deliveries.some((entry) => entry.orderId === order.id));
    const realCode = await counterCode(context.db, now);
    const wrongCode = realCode === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 5; attempt++) {
      const failed = await call(context.db, '/deliveries/presence', { user: courier, method: 'POST', body: { code: wrongCode } });
      assert.ok([400, 429].includes(failed.status));
    }
    assert.equal((await call(context.db, '/deliveries/presence', { user: courier, method: 'POST', body: { code: realCode } })).status, 429);
    const nextBucket = new Date(now.getTime() + 5 * minute);
    await attendance(context.db, courier, nextBucket);
    const shown = await call(context.db, '/deliveries', { user: courier, at: nextBucket });
    assert.ok(shown.data.deliveries.some((entry) => entry.orderId === order.id));
  } finally { context.db.close(); }
});

test('claim release replays safely and old pickup codes expire on reclaim', async () => {
  const context = await setup();
  try {
    await register(context.db, courier);
    await attendance(context.db, courier);
    const order = await deliveryOrder(context);
    assert.equal((await claim(context.db, order)).status, 200);
    const oldCode = await deliveryCode(context.db, order.id, 'pickup');
    const release = () => call(context.db, `/deliveries/${order.id}/release`, { user: courier, method: 'POST', body: {} });
    assert.equal((await release()).status, 200);
    assert.equal((await release()).status, 200);
    assert.equal((await claim(context.db, order)).status, 200);
    const stale = await call(context.db, `/deliveries/${order.id}/pickup`, { user: courier, method: 'POST', body: { code: oldCode } });
    assert.equal(stale.status, 400);
    assert.equal((await pickup(context.db, order)).status, 200);
    assert.equal((await pickup(context.db, order)).status, 200);
  } finally { context.db.close(); }
});

test('fine settlement unlocks exhausted receipt verification without wallet topups', async () => {
  const context = await setup();
  try {
    await register(context.db, courier);
    await attendance(context.db, courier);
    const order = await deliveryOrder(context);
    await claim(context.db, order);
    await pickup(context.db, order);
    const actual = await deliveryCode(context.db, order.id, 'recipient');
    const wrongCode = actual === '000000' ? '000001' : '000000';
    for (let index = 0; index < 5; index++) {
      assert.equal((await call(context.db, `/deliveries/${order.id}/confirm`, { method: 'POST', body: { code: wrongCode } })).status, 400);
    }
    const incident = await context.db.prepare('SELECT * FROM incidents WHERE order_id=?').bind(order.id).first();
    const fineBody = { action: 'fine', fine: 10, reason: 'Counter review verified the delivery issue.' };
    const reviews = await Promise.all(Array.from({ length: 3 }, () => call(context.db, `/vendor/incidents/${incident.id}`, {
      user: vendor, method: 'PATCH', body: fineBody,
    })));
    assert.ok(reviews.every((result) => result.status === 200));
    assert.equal((await call(context.db, `/incidents/${incident.id}/repay`, { user: courier, method: 'POST', body: {} })).status, 200);
    assert.equal(await walletBalance(context.db, courier.id), 0);
    assert.equal((await confirm(context.db, order)).status, 200);
  } finally { context.db.close(); }
});

test('concurrent hostel food orders receive their approved discount without a daily cap', async () => {
  const context = await setup();
  try {
    await register(context.db, customer, { needApproved: true });
    const results = await Promise.all(Array.from({ length: 8 }, () => place(context)));
    assert.ok(results.every((result) => [200, 201].includes(result.status)), JSON.stringify(results));
    assert.ok(results.every((result) => result.data.order.discountKind === 'hostel'));
  } finally { context.db.close(); }
});

test('one Google identity cannot back duplicate accounts and staff cannot claim student work', async () => {
  const context = await setup();
  try {
    await register(context.db, courier);
    await assert.rejects(context.db.prepare('INSERT INTO identities (user_id,google_sub,email,verified_at) VALUES (?,?,?,?)')
      .bind(secondCourier.id, `google-${courier.id}`, 'duplicate@nitc.ac.in', now.toISOString()).run());
    const staff = { ...secondCourier, id: 'staff-courier' };
    await register(context.db, staff, { role: 'staff' });
    const order = await deliveryOrder(context);
    assert.equal((await claim(context.db, order, staff)).status, 403);
    const expired = { ...secondCourier, id: 'expired-courier' };
    await register(context.db, expired, { expiresOn: '2026-11-23' });
    assert.equal((await claim(context.db, order, expired)).status, 403);
  } finally { context.db.close(); }
});

test('failed faculty handoff refunds actual payment once without restocking or courier earnings', async () => {
  const context = await setup();
  try {
    await register(context.db, courier);
    await attendance(context.db, courier);
    const order = await deliveryOrder(context, { customerType: 'faculty' });
    await claim(context.db, order);
    await pickup(context.db, order);
    await call(context.db, `/deliveries/${order.id}/report`, { method: 'POST', body: { reason: 'The recipient confirms that this handoff failed.' } });
    const incident = await context.db.prepare('SELECT * FROM incidents WHERE order_id=?').bind(order.id).first();
    const refund = (user = vendor) => call(context.db, `/vendor/incidents/${incident.id}`, {
      user, method: 'PATCH', body: { action: 'refund', reason: 'Counter staff confirmed that the faculty member received no food.' },
    });
    assert.equal((await refund(customer)).status, 403);
    const results = await Promise.all([refund(), refund(), refund()]);
    assert.ok(results.every((result) => result.status === 200), JSON.stringify(results));
    const record = await context.db.prepare('SELECT paid,status FROM orders WHERE id=?').bind(order.id).first();
    assert.equal(record.paid, 0);
    assert.equal(record.status, 'ready');
    assert.equal((await context.db.prepare('SELECT status FROM deliveries WHERE order_id=?').bind(order.id).first()).status, 'failed');
    const publicOrders = await call(context.db, '/orders');
    const publicRefund = publicOrders.data.orders.find((entry) => entry.id === order.id);
    assert.equal(publicRefund.status, 'refunded');
    assert.equal(publicRefund.balance, 0);
    assert.equal((await context.db.prepare("SELECT COUNT(*) AS count FROM wallet_entries WHERE source_id=? AND kind='compensation'").bind(order.id).first()).count, 1);
    assert.equal(await walletBalance(context.db, customer.id), Math.round(order.paid * 100));
    assert.equal(await walletBalance(context.db, courier.id), 0);
    assert.equal((await context.db.prepare('SELECT stock FROM menu WHERE id=?').bind(context.item.id).first()).stock, context.item.stock - 1);
    assert.equal((await context.db.prepare('SELECT reserved FROM slots WHERE id=?').bind(context.slot.id).first()).reserved, 1);
    assert.equal((await confirm(context.db, order)).status, 409);
    assert.equal((await context.db.prepare('SELECT status FROM incidents WHERE id=?').bind(incident.id).first()).status, 'open');
    await assert.rejects(context.db.prepare(`INSERT INTO wallet_entries (id,user_id,source_id,kind,amount_paise,created_at)
      VALUES ('forged-compensation',?,?,'compensation',999999,?)`).bind(customer.id, order.id, now.toISOString()).run());
  } finally { context.db.close(); }
});

test('failed deposit handoff restores paid wallet and test-payment portions while excluding unpaid balance', async () => {
  const context = await setup();
  try {
    await register(context.db, customer);
    await attendance(context.db, customer);
    const earning = await deliveryOrder(context, { user: otherCustomer });
    await claim(context.db, earning, customer);
    await pickup(context.db, earning, customer);
    await confirm(context.db, earning, otherCustomer);
    assert.ok(await walletBalance(context.db, customer.id) > 0);
    const meal = context.catalog.menu.find((item) => item.category === 'meal');
    const slot = context.catalog.slots.find((entry) => entry.category === 'meal');
    const order = await deliveryOrder(context, { slotId: slot.id, items: [{ menuItemId: meal.id, quantity: 1 }], paymentChoice: 'deposit', useWallet: true });
    assert.ok(order.walletUsed > 0);
    assert.ok(order.balance > 0);
    assert.ok(order.paid < order.total);
    assert.equal(await walletBalance(context.db, customer.id), 0);
    await register(context.db, courier);
    const at = new Date('2026-11-25T05:00:00.000Z');
    await attendance(context.db, courier, at);
    assert.equal((await claim(context.db, order, courier, at)).status, 200);
    assert.equal((await pickup(context.db, order, courier, at)).status, 200);
    assert.equal((await call(context.db, `/deliveries/${order.id}/report`, { method: 'POST', body: { reason: 'Counter verified that the meal was never handed to the recipient.' }, at })).status, 200);
    const incident = await context.db.prepare('SELECT * FROM incidents WHERE order_id=?').bind(order.id).first();
    const result = await call(context.db, `/vendor/incidents/${incident.id}`, {
      user: vendor, method: 'PATCH', body: { action: 'refund', reason: 'Verified unsuccessful handoff. Refund the amount actually paid.' }, at,
    });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(await walletBalance(context.db, customer.id), Math.round(order.paid * 100));
    assert.notEqual(await walletBalance(context.db, customer.id), Math.round(order.total * 100));
    assert.equal(await walletBalance(context.db, courier.id), 0);
  } finally { context.db.close(); }
});

test('changed quote prices require refreshed consent before checkout commits', async () => {
  const context = await setup();
  try {
    const quoteBody = { slotId: context.slot.id, items: [{ menuItemId: context.item.id, quantity: 1 }] };
    const original = await call(context.db, '/quote', { method: 'POST', body: quoteBody });
    assert.equal(original.status, 200);
    const previous = original.data.quote;
    assert.equal((await call(context.db, `/vendor/menu/${context.item.id}`, {
      user: vendor, method: 'PATCH', body: { price: context.item.price + 5 },
    })).status, 200);
    const before = (await context.db.prepare('SELECT COUNT(*) AS count FROM orders').first()).count;
    const changed = await place(context, {
      expectedTotal: previous.total, expectedDiscount: previous.discount, expectedWallet: previous.walletUsed,
    });
    assert.equal(changed.status, 409, JSON.stringify(changed));
    assert.equal((await context.db.prepare('SELECT COUNT(*) AS count FROM orders').first()).count, before);
    const refreshed = await call(context.db, '/quote', { method: 'POST', body: quoteBody });
    assert.equal(refreshed.status, 200);
    const current = refreshed.data.quote;
    const created = assertCreated(await place(context, {
      expectedTotal: current.total, expectedDiscount: current.discount, expectedWallet: current.walletUsed,
    }));
    assert.equal(created.total, current.total);
    assert.equal((await context.db.prepare('SELECT COUNT(*) AS count FROM orders').first()).count, before + 1);
  } finally { context.db.close(); }
});
