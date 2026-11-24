import type { Database, User } from './service';
import type { Delivery, DeliveryBoard, Incident } from './feature-types';

const minute = 60_000;
const keyCache = new WeakMap<Database, Promise<CryptoKey>>();
const response = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store' },
});

function reject(message: string, status = 400): never {
  throw { expected: true, message, status };
}

function campusDate(now: Date) {
  return new Date(now.getTime() + 330 * minute).toISOString().slice(0, 10);
}

async function readBody(request: Request): Promise<Record<string, any>> {
  const value = await request.json().catch(() => reject('Invalid request body.'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('Invalid request body.');
  return value;
}

function signingKey(db: Database): Promise<CryptoKey> {
  let pending = keyCache.get(db);
  if (!pending) {
    pending = (async () => {
      const secret = await db.prepare("SELECT value FROM settings WHERE key='delivery_secret'").first();
      if (!secret?.value) reject('Counter verification is being configured.', 503);
      return crypto.subtle.importKey('raw', new TextEncoder().encode(secret.value),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    })();
    keyCache.set(db, pending);
    pending.catch(() => keyCache.delete(db));
  }
  return pending;
}

async function codeFor(db: Database, purpose: string) {
  const signature = await crypto.subtle.sign('HMAC', await signingKey(db), new TextEncoder().encode(purpose));
  const value = new DataView(signature).getUint32(0, false) % 1_000_000;
  return String(value).padStart(6, '0');
}

function validCode(actual: unknown, expected: string) {
  if (typeof actual !== 'string' || !/^\d{6}$/.test(actual)) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export function counterCode(db: Database, now = new Date()) {
  return codeFor(db, `counter:${Math.floor(now.getTime() / (5 * minute))}`);
}

export async function deliveryCode(db: Database, orderId: string, kind: 'recipient' | 'pickup', _now = new Date()) {
  if (kind === 'recipient') return codeFor(db, `delivery:recipient:${orderId}`);
  const claim = await db.prepare('SELECT courier_user_id,claimed_at FROM deliveries WHERE order_id=?').bind(orderId).first();
  return codeFor(db, `delivery:pickup:${orderId}:${claim?.courier_user_id ?? ''}:${claim?.claimed_at ?? ''}`);
}

export async function walletBalance(db: Database, userId: string): Promise<number> {
  const result = await db.prepare('SELECT COALESCE(SUM(amount_paise),0) AS balance FROM wallet_entries WHERE user_id=?').bind(userId).first();
  return Number(result?.balance ?? 0);
}

async function courierEligible(db: Database, userId: string, now: Date) {
  const profile = await db.prepare(`SELECT r.student_id FROM identities i JOIN registry r ON r.email=i.email
    WHERE i.user_id=? AND r.role='student' AND r.active=1 AND r.student_id IS NOT NULL
      AND r.expires_on>=? AND NOT EXISTS (
        SELECT 1 FROM incidents WHERE courier_user_id=? AND status IN ('open','fined')
      )`).bind(userId, campusDate(now), userId).first();
  return Boolean(profile);
}

async function presenceUntil(db: Database, userId: string) {
  const row = await db.prepare('SELECT expires_at FROM courier_presence WHERE user_id=?').bind(userId).first();
  return row?.expires_at ?? null;
}

async function requirePresence(db: Database, userId: string, now: Date) {
  if (Number(await presenceUntil(db, userId)) <= now.getTime()) reject('Verify your presence with the current counter code.', 403);
}

function incidentResult(row: Record<string, any>): Incident {
  return { id: row.id, orderId: row.order_id, courierUserId: row.courier_user_id,
    status: row.status, reason: row.reason, fine: row.fine_paise / 100, createdAt: row.created_at };
}

async function incidentsFor(db: Database, user: User) {
  const sql = `SELECT * FROM incidents ${user.isVendor ? '' : 'WHERE courier_user_id=?'} ORDER BY created_at DESC LIMIT 200`;
  const result = await db.prepare(sql).bind(...(user.isVendor ? [] : [user.id])).all();
  return result.results.map(incidentResult);
}

export async function expireDeliveries(db: Database, now = new Date()) {
  const timestamp = now.getTime();
  await db.batch([
    db.prepare(`UPDATE deliveries SET status='open',courier_user_id=NULL,
      claim_expires_at=NULL,attempts=0 WHERE status='claimed' AND claim_expires_at<=?`).bind(timestamp),
    db.prepare(`INSERT INTO incidents (id,order_id,courier_user_id,status,reason,fine_paise,created_at)
      SELECT 'delivery-'||order_id,order_id,courier_user_id,'open',
        'The 30-minute delivery deadline passed. Counter review is required.',0,?
      FROM deliveries WHERE status='picked_up' AND deadline_at<=?
      ON CONFLICT(order_id) DO NOTHING`).bind(now.toISOString(), timestamp),
    db.prepare("UPDATE deliveries SET status='review_hold' WHERE status='picked_up' AND deadline_at<=?").bind(timestamp),
  ]);
}

async function board(db: Database, user: User, now: Date): Promise<DeliveryBoard> {
  const canDeliver = await courierEligible(db, user.id, now);
  const presence = await presenceUntil(db, user.id);
  const canViewOpen = canDeliver && Number(presence) > now.getTime();
  const rows = await db.prepare(`SELECT d.*,o.token,o.user_id,o.status AS order_status
    FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN slots s ON s.id=o.slot_id
    WHERE ?=1 OR o.user_id=? OR d.courier_user_id=? OR
      (?=1 AND d.status='open' AND o.status='ready' AND s.date=?)
    ORDER BY o.created_at DESC LIMIT 200`).bind(Number(user.isVendor), user.id, user.id, Number(canViewOpen), campusDate(now)).all();
  const itemRows: Record<string, any>[] = [];
  const ids = rows.results.map((row) => row.order_id);
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batchIds = ids.slice(offset, offset + 100);
    const batch = await db.prepare(`SELECT order_id,name,quantity FROM order_items WHERE order_id IN (${batchIds.map(() => '?').join(',')})`).bind(...batchIds).all();
    itemRows.push(...batch.results);
  }
  const deliveries = await Promise.all(rows.results.map(async (row): Promise<Delivery> => {
    const result: Delivery = {
      orderId: row.order_id, token: row.token, status: row.status, destination: row.destination,
      items: itemRows.filter((item) => item.order_id === row.order_id).map((item) => ({ name: item.name, quantity: item.quantity })),
      fee: row.fee_paise / 100, isMine: row.courier_user_id === user.id,
      claimedAt: row.status === 'open' ? null : row.claimed_at, claimExpiresAt: row.claim_expires_at, deadlineAt: row.deadline_at,
    };
    if (user.isVendor && row.status === 'claimed') result.pickupCode = await deliveryCode(db, row.order_id, 'pickup', now);
    if (row.user_id === user.id && ['picked_up', 'review_hold'].includes(row.status)) {
      result.recipientCode = await deliveryCode(db, row.order_id, 'recipient', now);
    }
    return result;
  }));
  return {
    deliveries, presenceUntil: presence, canDeliver,
    incidents: await incidentsFor(db, user),
    ...(user.isVendor ? { counterCode: await counterCode(db, now) } : {}),
  };
}

async function deliveryRow(db: Database, orderId: string) {
  return db.prepare(`SELECT d.*,o.user_id,o.status AS order_status,o.fulfillment,
    o.subtotal_paise,o.total FROM deliveries d JOIN orders o ON o.id=d.order_id WHERE d.order_id=?`).bind(orderId).first();
}

function reasonText(value: unknown) {
  if (typeof value !== 'string' || value.trim().length < 5 || value.trim().length > 500) reject('Describe the issue in 5–500 characters.');
  return value.trim();
}

async function resolveUnpickedHold(db: Database, orderId: string) {
  await db.prepare(`UPDATE deliveries SET status='open',courier_user_id=NULL,
    claim_expires_at=NULL,attempts=0 WHERE order_id=? AND status='review_hold' AND picked_up_at IS NULL`).bind(orderId).run();
}

export async function handleDeliveryApi(request: Request, db: Database, user: User | null, now = new Date()): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  const relevant = path === '/api/deliveries' || path === '/api/vendor/deliveries'
    || path.startsWith('/api/deliveries/') || path.startsWith('/api/incidents/')
    || path.startsWith('/api/vendor/incidents/');
  if (!relevant) return null;
  try {
    if (!user) reject('Sign in to use deliveries.', 401);
    const origin = request.headers.get('Origin');
    if (request.method !== 'GET' && ((origin && origin !== new URL(request.url).origin)
      || request.headers.get('Sec-Fetch-Site') === 'cross-site')) reject('Request origin is not allowed.', 403);
    if (path.startsWith('/api/vendor/') && !user.isVendor) reject('Vendor access is required.', 403);
    await expireDeliveries(db, now);
    if ((path === '/api/deliveries' || path === '/api/vendor/deliveries') && request.method === 'GET') {
      return response(await board(db, user, now));
    }
    if (path === '/api/deliveries/presence' && request.method === 'POST') {
      if (!await courierEligible(db, user.id, now)) reject('An active verified student registration is required. Resolve delivery holds at the counter.', 403);
      const data = await readBody(request);
      const attemptKey = `presence_attempts:${user.id}:${Math.floor(now.getTime() / (5 * minute))}`;
      const failed = await db.prepare('SELECT value FROM settings WHERE key=?').bind(attemptKey).first();
      if (Number(failed?.value ?? 0) >= 5) reject('Too many incorrect presence codes. Wait for the next five-minute code.', 429);
      if (!validCode(data.code, await counterCode(db, now))) {
        await db.prepare(`INSERT INTO settings (key,value) VALUES (?,'1') ON CONFLICT(key)
          DO UPDATE SET value=CAST(MIN(CAST(value AS INTEGER)+1,5) AS TEXT)`).bind(attemptKey).run();
        const attempts = await db.prepare('SELECT value FROM settings WHERE key=?').bind(attemptKey).first();
        if (Number(attempts?.value) >= 5) reject('Too many incorrect presence codes. Wait for the next five-minute code.', 429);
        reject('Use the current presence code shown at the counter.', 400);
      }
      const until = now.getTime() + 15 * minute;
      await db.prepare(`INSERT INTO courier_presence (user_id,expires_at) SELECT ?,?
        WHERE COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key=?),0)<5
        ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at`).bind(user.id, until, attemptKey).run();
      if (Number(await presenceUntil(db, user.id)) !== until) reject('Presence verification is locked until the next counter code.', 429);
      return response({ presenceUntil: until });
    }
    const operation = path.match(/^\/api\/deliveries\/([^/]+)\/(claim|pickup|confirm|release|report)$/);
    if (operation && request.method === 'POST') {
      const [, orderId, action] = operation;
      let row = await deliveryRow(db, orderId);
      if (!row) reject('Delivery not found.', 404);
      if (action === 'claim') {
        if (row.courier_user_id === user.id && ['claimed', 'picked_up'].includes(row.status)) return response(await board(db, user, now));
        if (!await courierEligible(db, user.id, now)) reject('An active verified student registration is required. Resolve delivery holds at the counter.', 403);
        await requirePresence(db, user.id, now);
        if (row.user_id === user.id) reject('Choose another customer’s delivery.', 409);
        const claimAt = Math.max(now.getTime(), Number(row.claimed_at ?? 0) + 1);
        await db.prepare(`UPDATE deliveries SET status='claimed',courier_user_id=?,claimed_at=?,
          claim_expires_at=?,attempts=0 WHERE order_id=? AND status='open'`).bind(user.id, claimAt, claimAt + 5 * minute, orderId).run();
        row = await deliveryRow(db, orderId);
        if (row?.status !== 'claimed' || row.courier_user_id !== user.id) reject('This delivery has already been claimed.', 409);
        return response(await board(db, user, now));
      }
      if (action === 'release') {
        if (row.status === 'open' && row.courier_user_id === null) return response(await board(db, user, now));
        if (row.courier_user_id !== user.id) reject('This delivery belongs to another courier.', 403);
        if (row.status !== 'claimed') reject('A delivery can be released before counter pickup.', 409);
        await db.prepare(`UPDATE deliveries SET status='open',courier_user_id=NULL,
          claim_expires_at=NULL,attempts=0 WHERE order_id=? AND status='claimed' AND courier_user_id=?`).bind(orderId, user.id).run();
        return response(await board(db, user, now));
      }
      if (action === 'pickup') {
        if (row.courier_user_id !== user.id) reject('This delivery belongs to another courier.', 403);
        if (row.status === 'picked_up') return response(await board(db, user, now));
        if (row.status !== 'claimed') reject('Claim this ready delivery before pickup.', 409);
        if (!await courierEligible(db, user.id, now)) reject('Resolve delivery holds at the counter before pickup.', 403);
        await requirePresence(db, user.id, now);
        const data = await readBody(request);
        if (row.attempts >= 5) reject('Counter verification is locked. Release this claim and ask the vendor for help.', 409);
        if (!validCode(data.code, await deliveryCode(db, orderId, 'pickup', now))) {
          await db.prepare("UPDATE deliveries SET attempts=attempts+1 WHERE order_id=? AND status='claimed'").bind(orderId).run();
          reject('The pickup code is incorrect. Ask the vendor at handoff.', 400);
        }
        await db.prepare(`UPDATE deliveries SET status='picked_up',picked_up_at=?,deadline_at=?,attempts=0
          WHERE order_id=? AND status='claimed' AND courier_user_id=? AND claim_expires_at>? AND attempts<5`).bind(now.getTime(), now.getTime() + 30 * minute, orderId, user.id, now.getTime()).run();
        row = await deliveryRow(db, orderId);
        if (row?.status !== 'picked_up') reject('This claim expired. Refresh the delivery board.', 409);
        return response(await board(db, user, now));
      }
      if (action === 'confirm') {
        if (row.user_id !== user.id) reject('Only the recipient can confirm receipt.', 403);
        if (row.status === 'delivered') return response(await board(db, user, now));
        if (!['picked_up', 'review_hold'].includes(row.status) || row.picked_up_at === null) reject('The delivery has not left the counter.', 409);
        const incident = await db.prepare('SELECT status FROM incidents WHERE order_id=?').bind(orderId).first();
        if (incident?.status === 'fined') reject('The counter must resolve the reviewed incident before receipt confirmation.', 409);
        if (row.attempts >= 5) reject('Receipt verification is locked. Ask the counter to review the incident.', 409);
        const data = await readBody(request);
        if (!validCode(data.code, await deliveryCode(db, orderId, 'recipient', now))) {
          await db.batch([
            db.prepare("UPDATE deliveries SET attempts=attempts+1 WHERE order_id=? AND status IN ('picked_up','review_hold')").bind(orderId),
            db.prepare(`INSERT INTO incidents (id,order_id,courier_user_id,status,reason,fine_paise,created_at)
              SELECT 'delivery-'||order_id,order_id,courier_user_id,'open','Receipt verification needs counter review.',0,?
              FROM deliveries WHERE order_id=? AND attempts>=5 ON CONFLICT(order_id) DO NOTHING`).bind(now.toISOString(), orderId),
            db.prepare("UPDATE deliveries SET status='review_hold' WHERE order_id=? AND status='picked_up' AND attempts>=5").bind(orderId),
          ]);
          reject('The receipt code is incorrect.', 400);
        }
        await db.batch([
          db.prepare(`UPDATE incidents SET status='cleared',reviewed_by=? WHERE order_id=? AND status='open'
            AND EXISTS (SELECT 1 FROM deliveries WHERE order_id=? AND status IN ('picked_up','review_hold') AND attempts<5)`)
            .bind(`recipient:${user.id}`, orderId, orderId),
          db.prepare(`UPDATE deliveries SET status='delivered',delivered_at=? WHERE order_id=?
            AND status IN ('picked_up','review_hold') AND attempts<5 AND NOT EXISTS (
              SELECT 1 FROM incidents WHERE order_id=? AND status='fined'
            )`).bind(now.getTime(), orderId, orderId),
        ]);
        row = await deliveryRow(db, orderId);
        if (row?.status !== 'delivered') reject('The incident changed. Refresh and contact the counter.', 409);
        return response(await board(db, user, now));
      }
      if (action === 'report') {
        if (row.user_id !== user.id && row.courier_user_id !== user.id) reject('Only the recipient or assigned courier can report this delivery.', 403);
        if (!['claimed', 'picked_up', 'review_hold'].includes(row.status)) reject('This delivery cannot enter review in its current state.', 409);
        const data = await readBody(request);
        const reason = reasonText(data.reason);
        await db.batch([
          db.prepare(`INSERT INTO incidents (id,order_id,courier_user_id,status,reason,fine_paise,created_at)
            SELECT 'delivery-'||order_id,order_id,courier_user_id,'open',?,0,? FROM deliveries
            WHERE order_id=? AND status IN ('claimed','picked_up','review_hold')
            ON CONFLICT(order_id) DO UPDATE SET status='open',reason=excluded.reason,fine_paise=0,reviewed_by=NULL
              WHERE incidents.status='cleared'`).bind(reason, now.toISOString(), orderId),
          db.prepare(`UPDATE deliveries SET status='review_hold' WHERE order_id=? AND status IN ('claimed','picked_up')
            AND EXISTS (SELECT 1 FROM incidents WHERE order_id=? AND status IN ('open','fined'))`).bind(orderId, orderId),
        ]);
        row = await deliveryRow(db, orderId);
        if (row?.status !== 'review_hold') reject('The delivery changed before the report. Refresh its status.', 409);
        return response(await board(db, user, now));
      }
    }
    const review = path.match(/^\/api\/vendor\/incidents\/([^/]+)$/);
    if (review && request.method === 'PATCH') {
      const data = await readBody(request);
      const reason = reasonText(data.reason);
      const found = await db.prepare(`SELECT i.*,o.subtotal_paise FROM incidents i JOIN orders o ON o.id=i.order_id WHERE i.id=?`).bind(review[1]).first();
      if (!found) reject('Incident not found.', 404);
      if (!['clear', 'fine', 'refund'].includes(data.action)) reject('Choose clear, fine or refund.');
      if (data.action === 'refund') {
        const delivery = await deliveryRow(db, found.order_id);
        if (delivery?.status === 'failed') return response(await board(db, user, now));
        if (delivery?.status !== 'review_hold' || delivery.picked_up_at === null) reject('Confirm the failed handoff in counter review after physical pickup.', 409);
        await db.batch([
          db.prepare(`UPDATE incidents SET reason=reason||char(10)||?,reviewed_by=? WHERE id=?
            AND EXISTS (SELECT 1 FROM deliveries WHERE order_id=? AND status='review_hold' AND picked_up_at IS NOT NULL)`)
            .bind(`Refund approved. ${reason}`, user.id, found.id, found.order_id),
          db.prepare(`UPDATE deliveries SET status='failed' WHERE order_id=?
            AND status='review_hold' AND picked_up_at IS NOT NULL`).bind(found.order_id),
          db.prepare(`INSERT INTO wallet_entries (id,user_id,source_id,kind,amount_paise,created_at)
            SELECT 'compensation-'||o.id,o.user_id,o.id,'compensation',CAST(ROUND(o.paid*100) AS INTEGER),?
            FROM orders o JOIN deliveries d ON d.order_id=o.id WHERE o.id=? AND d.status='failed' AND o.paid>0
              AND NOT EXISTS (SELECT 1 FROM wallet_entries WHERE source_id=o.id AND kind='compensation')`)
            .bind(now.toISOString(), found.order_id),
          db.prepare(`UPDATE orders SET paid=0 WHERE id=?
            AND EXISTS (SELECT 1 FROM deliveries WHERE order_id=? AND status='failed')`).bind(found.order_id, found.order_id),
        ]);
        if ((await deliveryRow(db, found.order_id))?.status !== 'failed') reject('Receipt or review changed before the refund. Refresh its status.', 409);
      } else if (data.action === 'fine') {
        const amount = typeof data.fine === 'number' ? Math.round(data.fine * 100) : NaN;
        if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount / 100 - data.fine) > 0.000001 || amount > found.subtotal_paise) reject('Enter a fine in rupees up to the order’s food value.');
        if (found.status === 'fined' && found.fine_paise === amount) return response(await board(db, user, now));
        if (found.status !== 'open') reject('This incident has already been reviewed.', 409);
        await db.prepare(`UPDATE incidents SET status='fined',fine_paise=?,reason=?,reviewed_by=? WHERE id=? AND status='open'`).bind(amount, reason, user.id, found.id).run();
        const saved = await db.prepare('SELECT status,fine_paise FROM incidents WHERE id=?').bind(found.id).first();
        if (saved?.status !== 'fined' || saved.fine_paise !== amount) reject('The incident changed during review. Refresh its status.', 409);
      } else {
        if (!['open', 'fined', 'cleared'].includes(found.status)) reject('This incident has already been settled.', 409);
        await db.prepare(`UPDATE incidents SET status='cleared',fine_paise=0,reason=?,reviewed_by=? WHERE id=? AND status IN ('open','fined')`).bind(reason, user.id, found.id).run();
        await db.prepare('UPDATE deliveries SET attempts=0 WHERE order_id=?').bind(found.order_id).run();
        await resolveUnpickedHold(db, found.order_id);
      }
      return response(await board(db, user, now));
    }
    const repay = path.match(/^\/api\/incidents\/([^/]+)\/repay$/);
    if (repay && request.method === 'POST') {
      const found = await db.prepare('SELECT * FROM incidents WHERE id=? AND courier_user_id=?').bind(repay[1], user.id).first();
      if (!found) reject('Incident not found.', 404);
      if (found.status !== 'fined' && found.status !== 'paid') reject('A reviewed fine is required for test settlement.', 409);
      await db.prepare("UPDATE incidents SET status='paid' WHERE id=? AND courier_user_id=? AND status='fined'").bind(found.id, user.id).run();
      await db.prepare('UPDATE deliveries SET attempts=0 WHERE order_id=?').bind(found.order_id).run();
      await resolveUnpickedHold(db, found.order_id);
      return response({ ...(await board(db, user, now)), paymentMode: 'test', message: 'Test fine settlement recorded. No money was collected.' });
    }
    return null;
  } catch (error: any) {
    if (error?.expected) return response({ error: error.message }, error.status);
    const message = String(error?.message ?? '');
    if (/claim|courier|delivery|reservation|wallet|discount|coupon|presence|custody/i.test(message)) {
      return response({ error: 'The delivery changed or your account is on hold. Refresh and check with the counter.' }, 409);
    }
    console.error('LunchLine delivery request failed', message);
    return response({ error: 'Delivery could not be completed. Please try again.' }, 500);
  }
}
