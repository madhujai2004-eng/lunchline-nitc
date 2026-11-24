# LunchLine

A responsive campus canteen pilot for customer ordering and a vendor order desk. It runs on React and Vinext with Cloudflare D1 for shared, durable orders. All payments are explicitly simulated.

## Customer flow

Browse today's express snacks or tomorrow's meals, search the menu, filter vegetarian options, add a basket, and select a pickup slot. Meals support a 50% test deposit or full test prepayment. Track the order from confirmed through preparing, ready, and collected. Customers can cancel a confirmed order before preparation starts.

## Vendor flow

The configured vendor account can see the shared queue, advance or cancel orders, update item prices, remaining stock and availability, and change the capacity of upcoming pickup slots. Capacity is measured in item units. Capacity cannot be reduced below existing reservations. Cancelling an order returns its inventory and slot capacity once. Price changes preserve prices already booked in existing orders.

## Run locally

Use Node.js 22.13 or later and npm. Install with `npm ci`. Copy `.env.example` to `.dev.vars` and set `VENDOR_EMAIL=seedy@sites.test` for the starter's local mock identity.

Run `npm run build`, then apply each migration once in order to the local database. Existing installations apply only pending migrations.

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_crazy_ben_parker.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_pink_chimera.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_delivery_refunds.sql
npm run dev
```

Open the printed localhost URL and select Sign in with ChatGPT. The portable development profile supplies a local mock identity. The hosted deployment uses Sites authentication. Set the hosted secret `VENDOR_EMAIL` to the authorized vendor email. Authorization is enforced on each vendor API request.

## Pilot settings

Menu descriptions, prices, initial stock and slot capacities are sample values. All dates and pickup times use Asia/Kolkata. Morning express slots are proposed pilot availability and require the operator to confirm staffing. Set a slot's capacity to zero to close it. Mess lunch is 12–2 PM and canteen lunch is 11:45 AM–2:30 PM, based on the project brief.

Menu stock is a shared remaining inventory counter and persists until the vendor replenishes it. It does not reset at midnight. Slot reservations persist for their own date. The UI lists the latest 200 orders. Earlier records stay in the database. Requests use customer-scoped idempotency keys to avoid duplicate checkout on retries. Stock, item price and slot reservations are checked atomically in D1.

The current Site is private to its owner. The owner can test both customer and vendor views. Live customer access requires configuring Site sharing. Accepting real payments requires a payment provider integration with server-verified payment confirmations, plus the operator's pickup and cancellation policies. Test collection settles only the simulated payment ledger.

## NIT Calicut campus pilot

The campus directory and map use official NIT Calicut sources linked in the application. East Campus canteen is the proposed pickup point for this pilot. Other named canteens are documented directory entries. Their inclusion does not establish participation, current menus, hours or delivery service. Destinations are named campus meeting points. The map provides orientation without estimating walking distances or live routes. Operators must confirm which meeting points they can serve.

## College identity and discounts

Hosted access uses the existing Sites sign-in. Google college identity is a separate verification step. Google activation is pending a Web OAuth Client ID. The administrator can enter a Client ID in Vendor → Google setup and register this exact deployed origin as an authorized JavaScript origin in Google Cloud. Do not enter a client secret. The app verifies the Google token signature, issuer, audience, expiry, session nonce, verified email and `hd=nitc.ac.in` on the server. A verified Google identity can link to one app account. No passwords are collected.

An administrator must add actual approved college records to the student registry, including institute ID, student/faculty/staff role, residence, active status, need-based approval and an expiry date. Email ownership alone establishes neither student status nor financial need. The app stores the approval decision, without collecting income evidence. Staff and faculty never receive student discounts through self-selected order roles.

Approved hostel students get 10% off food on each order. Approved day scholars get 25% off one eligible meal unit per pickup date in Asia/Kolkata. If a basket has several eligible meal portions, the discount uses the highest-priced single portion. Other portions and delivery charges use normal prices. A single institute ID prevents a second account or alternate email from reserving another discount. Cancellation before handoff releases a reserved meal discount and returns wallet funds once. A completed discount remains used for that date.

## Peer delivery and test wallet

All registered, active student couriers can volunteer, including students who are not approved for need-based discounts. Faculty and staff can order delivery at regular food prices. A student enters the rotating code shown at the East Campus pickup counter before claiming work. The code is a presence check, and the vendor separately gives a claim-specific pickup code when handing over food. This prevents GPS alone from authorizing custody. No background location tracking is collected.

The board shows ready orders for the current service date and supports destination filtering. A courier can hold at most five active orders, cannot deliver their own order, and has five minutes to collect a claimed order. Uncollected claims return to the board. The delivery clock is 30 minutes from verified counter pickup. The recipient confirms receipt using their own code. Earnings enter the student's internal test wallet once and can offset future food orders. Wallet entries are immutable, and concurrent spending cannot make the balance negative.

Delivery fees use the food subtotal before discounts. Up to ₹50 costs ₹10, ₹50.01–100 costs ₹15, ₹100.01–200 costs ₹20, and ₹200.01–300 costs ₹25. Each further started ₹100 adds ₹5. The complete charge is shown before ordering and becomes the courier's earning after confirmed receipt. Frozen desserts are pickup only.

A missed deadline or reported problem freezes the delivery and creates a review. New delivery claims pause for the assigned courier. An administrator can clear the incident or record a reasoned fine up to the order's food value. A reviewed fine blocks new ordering until cleared or test-settled. For a confirmed failed handoff, the administrator can refund exactly the amount already paid to the recipient's internal test wallet. That refund is issued once, clears any unpaid balance, preserves the physical food's inventory history, and prevents courier earnings. Disciplinary review remains separate from the customer's refund. Disputed handoffs remain visible for review. Fine settlement, order payments and wallet value are simulated in this pilot. No real funds are collected, paid out or withdrawn.

## Images

Food photos are stored under `public/food`. Credits and source links are served at `/photo-credits`. They illustrate the sample menu.

The vegetable puff image at `public/food/veg-puff.jpg` was generated with the built-in ImageGen tool using this prompt.

> Photorealistic menu photograph for an Indian college canteen. A golden flaky rectangular vegetarian puff pastry, one whole and one cut open to reveal a spiced potato, pea and carrot filling, on a plain white plate on a pale neutral tabletop. Natural soft window light. Close three-quarter overhead angle, food fills frame, appetizing realistic texture. No text, logo, packaging, hands, garnish or additional dishes. Square composition.
