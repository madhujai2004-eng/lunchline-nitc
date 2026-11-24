import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const menu = sqliteTable('menu', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  category: text('category').notNull(),
  vegetarian: integer('vegetarian').notNull(),
  price: integer('price').notNull(),
  stock: integer('stock').notNull(),
  available: integer('available').notNull(),
  image: text('image').notNull(),
  foodGroup:text('food_group').notNull().default('snacks'),
  mealEligible:integer('meal_eligible').notNull().default(0),
});
export const slots = sqliteTable('slots', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  time: text('time').notNull(),
  label: text('label').notNull(),
  category: text('category').notNull(),
  capacity: integer('capacity').notNull(),
  reserved: integer('reserved').notNull().default(0),
});
export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  token: text('token').notNull(),
  userId: text('user_id').notNull(),
  requestId: text('request_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
  name: text('name').notNull(),
  customerType: text('customer_type').notNull(),
  status: text('status').notNull(),
  category: text('category').notNull(),
  slotId: text('slot_id').notNull().references(() => slots.id),
  units: integer('units').notNull(),
  total: integer('total').notNull(),
  paid: integer('paid').notNull(),
  paymentChoice: text('payment_choice').notNull(),
  createdAt: text('created_at').notNull(),
  subtotalPaise: integer('subtotal_paise').notNull().default(0),
  discountPaise: integer('discount_paise').notNull().default(0),
  discountKind: text('discount_kind').notNull().default('none'),
  discountBasisPaise: integer('discount_basis_paise').notNull().default(0),
  studentId: text('student_id'),
  discountDate: text('discount_date'),
  fulfillment: text('fulfillment').notNull().default('pickup'),
  dropoffLocation: text('dropoff_location'),
  deliveryFeePaise: integer('delivery_fee_paise').notNull().default(0),
  walletUsedPaise: integer('wallet_used_paise').notNull().default(0),
}, (table) => [uniqueIndex('order_request').on(table.userId, table.requestId)]);
export const orderItems = sqliteTable('order_items', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id),
  menuItemId: text('menu_item_id').notNull().references(() => menu.id),
  name: text('name').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: integer('unit_price').notNull(),
});

export const settings = sqliteTable('settings', {
  key:text('key').primaryKey(), value:text('value').notNull(),
});
export const identities = sqliteTable('identities', {
  userId:text('user_id').primaryKey(),googleSub:text('google_sub').notNull().unique(),
  email:text('email').notNull().unique(),verifiedAt:text('verified_at').notNull(),
});
export const registry = sqliteTable('registry', {
  email:text('email').primaryKey(),studentId:text('student_id').unique(),role:text('role').notNull(),
  residence:text('residence').notNull(),needApproved:integer('need_approved').notNull().default(0),
  active:integer('active').notNull().default(1),expiresOn:text('expires_on').notNull(),
});
export const googleNonces = sqliteTable('google_nonces', {
  userId:text('user_id').primaryKey(),nonce:text('nonce').notNull(),expiresAt:integer('expires_at').notNull(),
});
export const discountClaims = sqliteTable('discount_claims', {
  orderId:text('order_id').primaryKey().references(()=>orders.id),studentId:text('student_id').notNull(),
  pickupDate:text('pickup_date').notNull(),status:text('status').notNull(),
});
export const deliveries = sqliteTable('deliveries', {
  orderId:text('order_id').primaryKey().references(()=>orders.id),status:text('status').notNull().default('open'),
  courierUserId:text('courier_user_id'),claimedAt:integer('claimed_at'),claimExpiresAt:integer('claim_expires_at'),
  pickedUpAt:integer('picked_up_at'),deadlineAt:integer('deadline_at'),deliveredAt:integer('delivered_at'),
  feePaise:integer('fee_paise').notNull(),destination:text('destination').notNull(),attempts:integer('attempts').notNull().default(0),
});
export const courierPresence = sqliteTable('courier_presence', {
  userId:text('user_id').primaryKey(),expiresAt:integer('expires_at').notNull(),
});
export const walletEntries = sqliteTable('wallet_entries', {
  id:text('id').primaryKey(),userId:text('user_id').notNull(),sourceId:text('source_id').notNull(),
  kind:text('kind').notNull(),amountPaise:integer('amount_paise').notNull(),createdAt:text('created_at').notNull(),
}, table=>[uniqueIndex('wallet_source_kind').on(table.sourceId,table.kind)]);
export const incidents = sqliteTable('incidents', {
  id:text('id').primaryKey(),orderId:text('order_id').notNull().unique(),courierUserId:text('courier_user_id').notNull(),
  status:text('status').notNull().default('open'),reason:text('reason').notNull(),finePaise:integer('fine_paise').notNull().default(0),
  createdAt:text('created_at').notNull(),reviewedBy:text('reviewed_by'),
});
