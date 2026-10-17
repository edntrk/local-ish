-- Sample Marrakech prices (MAD). Data role: replace with verified numbers and fill source + checked_on.
insert into price_items (id, city, category, name, min_price, max_price, currency, tip) values
  ('taxi-airport', 'marrakech', 'transport', 'Taxi: airport to Medina', 100, 150, 'MAD', 'Agree the price before you get in. Ask for the meter: "le compteur".'),
  ('taxi-city', 'marrakech', 'transport', 'Petit taxi within the city', 15, 30, 'MAD', 'Daytime rides should use the meter. Night fares are about 50% higher.'),
  ('tea', 'marrakech', 'food', 'Mint tea at a café', 10, 20, 'MAD', 'Prices near Jemaa el-Fna square are higher. One street back is cheaper.'),
  ('tagine', 'marrakech', 'food', 'Tagine at a local restaurant', 40, 80, 'MAD', 'Check the menu has prices on it before you sit down.'),
  ('oj', 'marrakech', 'food', 'Orange juice at Jemaa el-Fna', 4, 10, 'MAD', 'Stalls show the price on a sign. Ask for fresh, not mixed with water.'),
  ('water', 'marrakech', 'food', 'Water, 1.5L bottle', 5, 8, 'MAD', 'Corner shops are cheapest. Tourist kiosks often charge double.'),
  ('sim', 'marrakech', 'sim', 'Tourist SIM with data', 30, 60, 'MAD', 'Buy at an official Maroc Telecom, Orange or inwi shop. Bring your passport.'),
  ('babouche', 'marrakech', 'shopping', 'Leather babouche slippers', 80, 150, 'MAD', 'Start at about half the first price and meet in the middle.'),
  ('argan', 'marrakech', 'shopping', 'Argan oil, 100ml', 60, 120, 'MAD', 'Cooperatives sell pure oil with a label. Very cheap oil is often mixed.')
on conflict (city, id) do update set min_price = excluded.min_price, max_price = excluded.max_price, tip = excluded.tip;
