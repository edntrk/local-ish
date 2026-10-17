-- Sample Bali prices (IDR), same list as apps/api/src/data/seed-prices.ts. Data role: replace with verified numbers and real sources.
insert into price_items (id, city, category, name, min_price, max_price, currency, tip, source, checked_on) values
  ('taxi-airport', 'bali', 'transport', 'Taxi: airport to Seminyak', 150000, 250000, 'IDR', 'Use Grab or the official counter, or agree the price before you get in. Ask for the meter: "argo".', 'Estimate, not yet verified', '2026-10-17'),
  ('taxi-city', 'bali', 'transport', 'Short ride by Grab or Gojek', 20000, 50000, 'IDR', 'The app shows the price before you go. Street taxis often quote double.', 'Estimate, not yet verified', '2026-10-17'),
  ('scooter', 'bali', 'transport', 'Scooter rental, per day', 70000, 100000, 'IDR', 'Check the brakes and photo the scooter before you ride off.', 'Estimate, not yet verified', '2026-10-17'),
  ('tea', 'bali', 'food', 'Iced tea at a café', 10000, 25000, 'IDR', 'Beach clubs charge 3 to 4 times more. One street back is cheaper.', 'Estimate, not yet verified', '2026-10-17'),
  ('nasi', 'bali', 'food', 'Nasi goreng at a warung', 25000, 50000, 'IDR', 'Check the menu has prices on it before you sit down.', 'Estimate, not yet verified', '2026-10-17'),
  ('oj', 'bali', 'food', 'Fresh juice at a stall', 15000, 35000, 'IDR', 'Ask for no sugar syrup and no ice if you are unsure about the water.', 'Estimate, not yet verified', '2026-10-17'),
  ('water', 'bali', 'food', 'Water, 1.5L bottle', 6000, 12000, 'IDR', 'Minimarkets are cheapest. Beach kiosks often charge double.', 'Estimate, not yet verified', '2026-10-17'),
  ('sim', 'bali', 'sim', 'Tourist SIM with data', 100000, 200000, 'IDR', 'Buy at an official Telkomsel or XL shop. Bring your passport.', 'Estimate, not yet verified', '2026-10-17'),
  ('sarong', 'bali', 'shopping', 'Batik sarong at a market', 50000, 150000, 'IDR', 'Start at about half the first price and meet in the middle.', 'Estimate, not yet verified', '2026-10-17'),
  ('carving', 'bali', 'shopping', 'Small wooden carving', 100000, 250000, 'IDR', 'Check the finish and ask where it was made. Shop prices are often fixed.', 'Estimate, not yet verified', '2026-10-17')
on conflict (city, id) do update set min_price = excluded.min_price, max_price = excluded.max_price, tip = excluded.tip, source = excluded.source, checked_on = excluded.checked_on;
