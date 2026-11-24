-- Reservations and inventory are committed together by the checkout D1 batch.
CREATE TRIGGER menu_stock_insert_guard
BEFORE INSERT ON menu
WHEN NEW.stock < 0 OR typeof(NEW.stock) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'Stock must be a nonnegative whole number');
END;
--> statement-breakpoint
CREATE TRIGGER menu_stock_update_guard
BEFORE UPDATE OF stock ON menu
WHEN NEW.stock < 0 OR typeof(NEW.stock) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'Stock must be a nonnegative whole number');
END;
--> statement-breakpoint
CREATE TRIGGER slot_capacity_insert_guard
BEFORE INSERT ON slots
WHEN NEW.capacity < 0 OR NEW.reserved < 0 OR NEW.capacity < NEW.reserved
  OR typeof(NEW.capacity) <> 'integer' OR typeof(NEW.reserved) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'Slot capacity must cover its reserved items');
END;
--> statement-breakpoint
CREATE TRIGGER slot_capacity_update_guard
BEFORE UPDATE OF capacity, reserved ON slots
WHEN NEW.capacity < 0 OR NEW.reserved < 0 OR NEW.capacity < NEW.reserved
  OR typeof(NEW.capacity) <> 'integer' OR typeof(NEW.reserved) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'Slot capacity must cover its reserved items');
END;
--> statement-breakpoint
CREATE TRIGGER order_slot_insert_guard
BEFORE INSERT ON orders
BEGIN
  SELECT CASE WHEN NEW.units < 1 OR typeof(NEW.units) <> 'integer'
    THEN RAISE(ABORT, 'An order must reserve whole items') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM slots
    WHERE id = NEW.slot_id AND category = NEW.category
      AND reserved + NEW.units <= capacity
  ) THEN RAISE(ABORT, 'Pickup slot is unavailable') END;
END;
--> statement-breakpoint
CREATE TRIGGER order_slot_reserve
AFTER INSERT ON orders
BEGIN
  UPDATE slots SET reserved = reserved + NEW.units WHERE id = NEW.slot_id;
END;
--> statement-breakpoint
CREATE TRIGGER order_item_insert_guard
BEFORE INSERT ON order_items
BEGIN
  SELECT CASE WHEN NEW.quantity < 1 OR typeof(NEW.quantity) <> 'integer'
    THEN RAISE(ABORT, 'Order quantity must be a positive whole number') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM menu m JOIN orders o ON o.id = NEW.order_id
    WHERE m.id = NEW.menu_item_id AND m.available = 1
      AND m.category = o.category AND o.status = 'confirmed'
      AND m.price = NEW.unit_price AND m.stock >= NEW.quantity
  ) THEN RAISE(ABORT, 'Menu item stock, price or availability changed') END;
END;
--> statement-breakpoint
CREATE TRIGGER order_item_reserve_stock
AFTER INSERT ON order_items
BEGIN
  UPDATE menu SET stock = stock - NEW.quantity WHERE id = NEW.menu_item_id;
END;
--> statement-breakpoint
CREATE TRIGGER order_cancel_release
AFTER UPDATE OF status ON orders
WHEN NEW.status = 'cancelled' AND OLD.status <> 'cancelled'
BEGIN
  UPDATE slots SET reserved = reserved - OLD.units WHERE id = OLD.slot_id;
  UPDATE menu
  SET stock = stock + (
    SELECT SUM(oi.quantity) FROM order_items oi
    WHERE oi.order_id = OLD.id AND oi.menu_item_id = menu.id
  )
  WHERE id IN (SELECT menu_item_id FROM order_items WHERE order_id = OLD.id);
END;
