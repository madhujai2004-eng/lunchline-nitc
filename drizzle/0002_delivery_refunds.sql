DROP TRIGGER delivery_state_guard;
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
    (OLD.status='review_hold' AND NEW.status='failed' AND OLD.picked_up_at IS NOT NULL) OR
    (OLD.status='review_hold' AND NEW.status IN ('open','released') AND OLD.picked_up_at IS NULL)
  ) THEN RAISE(ABORT,'Delivery status transition is unavailable') END;
  SELECT CASE WHEN NEW.courier_user_id IS NOT OLD.courier_user_id
    AND NOT ((OLD.status='open' AND NEW.status='claimed')
      OR (OLD.status IN ('claimed','review_hold') AND NEW.status IN ('open','released')))
    THEN RAISE(ABORT,'Delivery custody cannot be reassigned') END;
  SELECT CASE WHEN NEW.status IN ('claimed','picked_up','review_hold','delivered','failed') AND NEW.courier_user_id IS NULL
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
DROP TRIGGER wallet_entry_guard;
--> statement-breakpoint
CREATE TRIGGER wallet_entry_guard
BEFORE INSERT ON wallet_entries
BEGIN
  SELECT CASE WHEN typeof(NEW.amount_paise)<>'integer' OR NEW.kind NOT IN ('earning','spend','refund','fine_payment','compensation')
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
  SELECT CASE WHEN NEW.kind='compensation' AND NOT EXISTS (
    SELECT 1 FROM orders o JOIN deliveries d ON d.order_id=o.id
    WHERE o.id=NEW.source_id AND o.user_id=NEW.user_id AND d.status='failed'
      AND d.picked_up_at IS NOT NULL AND NEW.amount_paise=CAST(ROUND(o.paid*100) AS INTEGER)
      AND NEW.amount_paise>0
  ) THEN RAISE(ABORT,'Delivery compensation must equal the recipient actual paid amount') END;
  SELECT CASE WHEN COALESCE((SELECT SUM(amount_paise) FROM wallet_entries WHERE user_id=NEW.user_id),0)+NEW.amount_paise<0
    THEN RAISE(ABORT,'Wallet funds were used by another checkout') END;
END;
