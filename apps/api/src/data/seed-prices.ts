import type { PriceItem } from "@fairfare/shared";

/** Sample Marrakech prices in MAD. DATA role: replace with verified numbers + sources before the demo. */
export const SEED_PRICES: PriceItem[] = [
  { id: "taxi-airport", city: "marrakech", category: "transport", name: "Taxi: airport to Medina", min: 100, max: 150, currency: "MAD", tip: 'Agree the price before you get in. Ask for the meter: "le compteur".' },
  { id: "taxi-city", city: "marrakech", category: "transport", name: "Petit taxi within the city", min: 15, max: 30, currency: "MAD", tip: "Daytime rides should use the meter. Night fares are about 50% higher." },
  { id: "tea", city: "marrakech", category: "food", name: "Mint tea at a café", min: 10, max: 20, currency: "MAD", tip: "Prices near Jemaa el-Fna square are higher. One street back is cheaper." },
  { id: "tagine", city: "marrakech", category: "food", name: "Tagine at a local restaurant", min: 40, max: 80, currency: "MAD", tip: "Check the menu has prices on it before you sit down." },
  { id: "oj", city: "marrakech", category: "food", name: "Orange juice at Jemaa el-Fna", min: 4, max: 10, currency: "MAD", tip: "Stalls show the price on a sign. Ask for fresh, not mixed with water." },
  { id: "water", city: "marrakech", category: "food", name: "Water, 1.5L bottle", min: 5, max: 8, currency: "MAD", tip: "Corner shops are cheapest. Tourist kiosks often charge double." },
  { id: "sim", city: "marrakech", category: "sim", name: "Tourist SIM with data", min: 30, max: 60, currency: "MAD", tip: "Buy at an official Maroc Telecom, Orange or inwi shop. Bring your passport." },
  { id: "babouche", city: "marrakech", category: "shopping", name: "Leather babouche slippers", min: 80, max: 150, currency: "MAD", tip: "Start at about half the first price and meet in the middle." },
  { id: "argan", city: "marrakech", category: "shopping", name: "Argan oil, 100ml", min: 60, max: 120, currency: "MAD", tip: "Cooperatives sell pure oil with a label. Very cheap oil is often mixed." },
];
