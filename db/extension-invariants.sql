CREATE UNIQUE INDEX daily_discount_student_date
ON discount_claims(student_id,pickup_date) WHERE status<>'released';
--> statement-breakpoint
CREATE TRIGGER order_discount_guard
BEFORE INSERT ON orders
BEGIN
  SELECT CASE WHEN NEW.discount_paise<0 OR NEW.discount_paise>NEW.subtotal_paise
    OR NEW.discount_basis_paise<0 OR NEW.delivery_fee_paise<0 OR NEW.wallet_used_paise<0
    OR typeof(NEW.discount_paise)<>'integer' OR typeof(NEW.subtotal_paise)<>'integer'
    OR typeof(NEW.discount_basis_paise)<>'integer' OR typeof(NEW.delivery_fee_paise)<>'integer'
    OR typeof(NEW.wallet_used_paise)<>'integer'
    THEN RAISE(ABORT,'Order discount and wallet amounts must use whole paise') END;
  SELECT CASE WHEN NEW.discount_kind NOT IN ('none','hostel','day_scholar')
    OR (NEW.discount_kind='none' AND NEW.discount_paise<>0)
    OR (NEW.discount_kind='hostel' AND NEW.discount_paise<>CAST(ROUND(NEW.subtotal_paise*0.10) AS INTEGER))
    OR (NEW.discount_kind='day_scholar' AND NEW.discount_paise<>CAST(ROUND(NEW.discount_basis_paise*0.25) AS INTEGER))
    THEN RAISE(ABORT,'Order discount does not match its approved rate') END;
  SELECT CASE WHEN NEW.discount_kind<>'none' AND NOT EXISTS (
    SELECT 1 FROM identities i JOIN registry r ON r.email=i.email JOIN slots s ON s.id=NEW.slot_id
    WHERE i.user_id=NEW.user_id AND r.student_id=NEW.student_id AND r.role='student'
      AND r.residence=NEW.discount_kind AND r.need_approved=1 AND r.active=1
      AND r.expires_on>=s.date AND NEW.discount_date=s.date
  ) THEN RAISE(ABORT,'Discount eligibility is unavailable') END;
  SELECT CASE WHEN NEW.wallet_used_paise>CAST(ROUND(NEW.total*100) AS INTEGER)
    THEN RAISE(ABORT,'Wallet use exceeds the order total') END;
END;
--> statement-breakpoint
CREATE TRIGGER discount_claim_guard
BEFORE INSERT ON discount_claims
BEGIN
  SELECT CASE WHEN NEW.status<>'reserved' OR NOT EXISTS (
    SELECT 1 FROM orders o JOIN identities i ON i.user_id=o.user_id
      JOIN registry r ON r.email=i.email JOIN slots s ON s.id=o.slot_id
    WHERE o.id=NEW.order_id AND o.status='confirmed' AND o.discount_kind='day_scholar'
      AND o.student_id=NEW.student_id AND o.discount_date=NEW.pickup_date AND s.date=NEW.pickup_date
      AND r.student_id=NEW.student_id AND r.role='student' AND r.residence='day_scholar'
      AND r.need_approved=1 AND r.active=1 AND r.expires_on>=NEW.pickup_date
      AND EXISTS (
        SELECT 1 FROM order_items oi JOIN menu m ON m.id=oi.menu_item_id
        WHERE oi.order_id=o.id AND m.meal_eligible=1 AND oi.unit_price*100=o.discount_basis_paise
      )
  ) THEN RAISE(ABORT,'Daily meal discount eligibility is unavailable') END;
END;
--> statement-breakpoint
CREATE TRIGGER discount_claim_transition_guard
BEFORE UPDATE ON discount_claims
WHEN NEW.order_id<>OLD.order_id OR NEW.student_id<>OLD.student_id OR NEW.pickup_date<>OLD.pickup_date
  OR NOT (NEW.status=OLD.status OR (OLD.status='reserved' AND NEW.status IN ('used','released')))
BEGIN
  SELECT RAISE(ABORT,'Daily meal discount reservation cannot be reused');
END;
--> statement-breakpoint
CREATE TRIGGER order_discount_collect
AFTER UPDATE OF status ON orders
WHEN NEW.status='collected' AND OLD.status<>'collected'
BEGIN
  UPDATE discount_claims SET status='used' WHERE order_id=NEW.id AND status='reserved';
END;
--> statement-breakpoint
CREATE TRIGGER order_amount_snapshot_guard
BEFORE UPDATE OF total,subtotal_paise,discount_paise,discount_kind,discount_basis_paise,
  student_id,discount_date,fulfillment,dropoff_location,delivery_fee_paise,wallet_used_paise ON orders
WHEN NEW.total<>OLD.total OR NEW.subtotal_paise<>OLD.subtotal_paise OR NEW.discount_paise<>OLD.discount_paise
  OR NEW.discount_kind<>OLD.discount_kind OR NEW.discount_basis_paise<>OLD.discount_basis_paise
  OR NEW.student_id IS NOT OLD.student_id OR NEW.discount_date IS NOT OLD.discount_date
  OR NEW.fulfillment<>OLD.fulfillment OR NEW.dropoff_location IS NOT OLD.dropoff_location
  OR NEW.delivery_fee_paise<>OLD.delivery_fee_paise OR NEW.wallet_used_paise<>OLD.wallet_used_paise
BEGIN
  SELECT RAISE(ABORT,'Order money and fulfillment are fixed at checkout');
END;
--> statement-breakpoint
CREATE TRIGGER delivery_insert_guard
BEFORE INSERT ON deliveries
BEGIN
  SELECT CASE WHEN NEW.status<>'open' OR NEW.courier_user_id IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM orders WHERE id=NEW.order_id AND fulfillment='delivery' AND status='confirmed'
      AND delivery_fee_paise=NEW.fee_paise AND dropoff_location=NEW.destination
  ) THEN RAISE(ABORT,'Delivery must match its confirmed order') END;
END;
--> statement-breakpoint
CREATE TRIGGER delivery_claim_guard
BEFORE UPDATE OF status,courier_user_id ON deliveries
WHEN NEW.status='claimed' AND (OLD.status<>'claimed' OR NEW.courier_user_id IS NOT OLD.courier_user_id)
BEGIN
  SELECT CASE WHEN OLD.status<>'open' OR NEW.courier_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM orders o JOIN slots s ON s.id=o.slot_id
    WHERE o.id=NEW.order_id AND o.fulfillment='delivery' AND o.status='ready'
      AND o.user_id<>NEW.courier_user_id
      AND s.date=substr(datetime(NEW.claimed_at/1000,'unixepoch','+330 minutes'),1,10)
  ) THEN RAISE(ABORT,'Delivery is unavailable for this courier') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM identities i JOIN registry r ON r.email=i.email
    WHERE i.user_id=NEW.courier_user_id AND r.role='student' AND r.student_id IS NOT NULL
      AND r.active=1 AND r.expires_on>=substr(datetime(NEW.claimed_at/1000,'unixepoch','+330 minutes'),1,10)
  ) THEN RAISE(ABORT,'Courier requires an active verified student registration') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM courier_presence WHERE user_id=NEW.courier_user_id AND expires_at>NEW.claimed_at
  ) THEN RAISE(ABORT,'Courier counter presence is required') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM incidents WHERE courier_user_id=NEW.courier_user_id AND status IN ('open','fined')
  ) THEN RAISE(ABORT,'Courier has an unresolved delivery incident') END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM deliveries WHERE courier_user_id=NEW.courier_user_id
      AND status IN ('claimed','picked_up','review_hold') AND order_id<>NEW.order_id
  )>=5 THEN RAISE(ABORT,'Courier can hold at most five active deliveries') END;
END;
--> statement-breakpoint
CREATE TRIGGER delivery_state_guard
BEFORE UPDATE ON deliveries
BEGIN
  SELECT CASE WHEN NEW.order_id<>OLD.order_id OR NEW.fee_paise<>OLD.fee_paise OR NEW.destination<>OLD.destination
    THEN RAISE(ABORT,'Delivery fee and destination are fixed at checkout') END;
  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='open' AND NEW.status IN ('claimed','released')) OR
    (OLD.status='claimed' AND NEW.status IN ('open','picked_up','review_hold','released')) OR
    (OLD.status='picked_up' AND NEW.status IN ('review_hold','delivered')) OR
    (OLD.status='review_hold' AND NEW.status='delivered') OR
    (OLD.status='review_hold' AND NEW.status IN ('open','released') AND OLD.picked_up_at IS NULL)
  ) THEN RAISE(ABORT,'Delivery status transition is unavailable') END;
  SELECT CASE WHEN NEW.courier_user_id IS NOT OLD.courier_user_id
    AND NOT ((OLD.status='open' AND NEW.status='claimed')
      OR (OLD.status IN ('claimed','review_hold') AND NEW.status IN ('open','released')))
    THEN RAISE(ABORT,'Delivery custody cannot be reassigned') END;
  SELECT CASE WHEN NEW.status IN ('claimed','picked_up','review_hold','delivered') AND NEW.courier_user_id IS NULL
    THEN RAISE(ABORT,'Delivery custody requires a courier') END;
  SELECT CASE WHEN NEW.status='picked_up' AND OLD.status='claimed' AND (
    NEW.picked_up_at IS NULL OR NEW.deadline_at<>NEW.picked_up_at+1800000
    OR OLD.claim_expires_at<=NEW.picked_up_at OR NOT EXISTS (
      SELECT 1 FROM courier_presence WHERE user_id=NEW.courier_user_id AND expires_at>NEW.picked_up_at
    )
  ) THEN RAISE(ABORT,'Delivery pickup needs valid presence and a 30-minute deadline') END;
  SELECT CASE WHEN NEW.status='delivered' AND OLD.status<>'delivered' AND (
    NEW.picked_up_at IS NULL OR NEW.delivered_at IS NULL OR EXISTS (
      SELECT 1 FROM incidents WHERE order_id=NEW.order_id AND status='fined'
    )
  ) THEN RAISE(ABORT,'Delivery receipt is awaiting incident review') END;
END;
--> statement-breakpoint
CREATE TRIGGER delivery_complete
AFTER UPDATE OF status ON deliveries
WHEN NEW.status='delivered' AND OLD.status<>'delivered'
BEGIN
  UPDATE orders SET status='collected',paid=total WHERE id=NEW.order_id;
  INSERT INTO wallet_entries (id,user_id,source_id,kind,amount_paise,created_at)
  VALUES ('earning-'||NEW.order_id,NEW.courier_user_id,NEW.order_id,'earning',NEW.fee_paise,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.delivered_at/1000.0,'unixepoch'));
END;
--> statement-breakpoint
CREATE TRIGGER order_delivery_collect_guard
BEFORE UPDATE OF status ON orders
WHEN NEW.status='collected' AND OLD.status<>'collected' AND NEW.fulfillment='delivery'
  AND NOT EXISTS (SELECT 1 FROM deliveries WHERE order_id=NEW.id AND status='delivered')
BEGIN
  SELECT RAISE(ABORT,'Recipient delivery confirmation is required');
END;
--> statement-breakpoint
CREATE TRIGGER order_custody_cancel_guard
BEFORE UPDATE OF status ON orders
WHEN NEW.status='cancelled' AND OLD.status<>'cancelled'
  AND (OLD.status='collected' OR EXISTS (
    SELECT 1 FROM deliveries WHERE order_id=NEW.id AND picked_up_at IS NOT NULL
  ))
BEGIN
  SELECT RAISE(ABORT,'An order in delivery custody cannot be cancelled');
END;
--> statement-breakpoint
CREATE TRIGGER order_extension_cancel
AFTER UPDATE OF status ON orders
WHEN NEW.status='cancelled' AND OLD.status<>'cancelled'
BEGIN
  UPDATE deliveries SET status='released',courier_user_id=NULL,claimed_at=NULL,claim_expires_at=NULL
    WHERE order_id=NEW.id AND status IN ('open','claimed','review_hold') AND picked_up_at IS NULL;
  UPDATE discount_claims SET status='released' WHERE order_id=NEW.id AND status='reserved';
  INSERT INTO wallet_entries (id,user_id,source_id,kind,amount_paise,created_at)
    SELECT 'refund-'||NEW.id,NEW.user_id,NEW.id,'refund',NEW.wallet_used_paise,
      strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NEW.wallet_used_paise>0;
END;
--> statement-breakpoint
CREATE TRIGGER wallet_entry_guard
BEFORE INSERT ON wallet_entries
BEGIN
  SELECT CASE WHEN typeof(NEW.amount_paise)<>'integer' OR NEW.kind NOT IN ('earning','spend','refund','fine_payment')
    THEN RAISE(ABORT,'Wallet entry must use a supported kind and whole paise') END;
  SELECT CASE WHEN NEW.kind='earning' AND NOT EXISTS (
    SELECT 1 FROM deliveries d JOIN orders o ON o.id=d.order_id WHERE d.order_id=NEW.source_id
      AND d.status='delivered' AND d.courier_user_id=NEW.user_id AND o.user_id<>NEW.user_id
      AND d.fee_paise=NEW.amount_paise AND NEW.amount_paise>0
  ) THEN RAISE(ABORT,'Wallet earning requires a completed peer delivery') END;
  SELECT CASE WHEN NEW.kind='spend' AND NOT EXISTS (
    SELECT 1 FROM orders WHERE id=NEW.source_id AND user_id=NEW.user_id AND status='confirmed'
      AND wallet_used_paise=-NEW.amount_paise AND NEW.amount_paise<0
  ) THEN RAISE(ABORT,'Wallet spending must match its confirmed order') END;
  SELECT CASE WHEN NEW.kind='refund' AND NOT EXISTS (
    SELECT 1 FROM orders o JOIN wallet_entries w ON w.source_id=o.id AND w.kind='spend'
    WHERE o.id=NEW.source_id AND o.user_id=NEW.user_id AND o.status='cancelled'
      AND o.wallet_used_paise=NEW.amount_paise AND w.user_id=NEW.user_id
      AND w.amount_paise=-NEW.amount_paise AND NEW.amount_paise>0
  ) THEN RAISE(ABORT,'Wallet refund must match the original spend once') END;
  SELECT CASE WHEN NEW.kind='fine_payment' AND (NEW.amount_paise<>0 OR NOT EXISTS (
    SELECT 1 FROM incidents WHERE id=NEW.source_id AND courier_user_id=NEW.user_id AND status='paid'
  )) THEN RAISE(ABORT,'Fine settlement is separate from wallet funds') END;
  SELECT CASE WHEN COALESCE((SELECT SUM(amount_paise) FROM wallet_entries WHERE user_id=NEW.user_id),0)+NEW.amount_paise<0
    THEN RAISE(ABORT,'Wallet funds were used by another checkout') END;
END;
--> statement-breakpoint
CREATE TRIGGER wallet_entry_update_guard
BEFORE UPDATE ON wallet_entries
BEGIN
  SELECT RAISE(ABORT,'Wallet ledger entries are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER wallet_entry_delete_guard
BEFORE DELETE ON wallet_entries
BEGIN
  SELECT RAISE(ABORT,'Wallet ledger entries are immutable');
END;
