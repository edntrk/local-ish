import { randomUUID } from "node:crypto";
import type { Expense, NewExpense, Trip } from "@fairfare/shared";
import type { DataStore } from "../ports";
import { SEED_PRICES } from "./seed-prices";

/** In-memory store. Works with no database, resets when the server restarts. */
export class MockDataStore implements DataStore {
  private trips = new Map<string, Trip>();
  private expenses: Expense[] = [];
  private reserved = new Set<string>(); // codes handed out before their trip exists

  constructor() {
    // a demo trip so the Interface has something to show straight away
    const demo: Trip = {
      id: "demo", city: "bali", currency: "IDR", homeCurrency: "GBP", rateToLocal: 21500, budgetHome: 600,
      start: "2026-10-24", end: "2026-10-30", inviteCode: "BAL-24OCT",
      people: [
        { id: "me", name: "Renata", isMe: true, status: "joined" },
        { id: "bella", name: "Bella", isMe: false, status: "joined" },
        { id: "dewi", name: "Dewi", isMe: false, status: "joined" },
      ],
    };
    this.trips.set(demo.id, demo);
    this.expenses.push({ id: "e-demo", tripId: "demo", item: "Taxi: airport to Seminyak", category: "transport", amount: 350000, paidBy: "me", shares: { me: 116666.67, bella: 116666.67, dewi: 116666.66 }, createdAt: new Date().toISOString() });
  }

  async listPrices(city: string) { return SEED_PRICES.filter((p) => p.city === city.toLowerCase()); }
  async getPrice(city: string, itemId: string) { return SEED_PRICES.find((p) => p.city === city.toLowerCase() && p.id === itemId) ?? null; }

  private freshCode() {
    for (;;) {
      const code = "BAL-" + Math.random().toString(36).slice(2, 7).toUpperCase();
      if (!this.reserved.has(code) && ![...this.trips.values()].some((x) => x.inviteCode === code)) return code;
    }
  }
  async reserveInviteCode() { const code = this.freshCode(); this.reserved.add(code); return code; }
  async isInviteReserved(code: string) { return this.reserved.has(code.trim().toUpperCase()); }
  async createTrip(t: Omit<Trip, "id" | "inviteCode"> & { inviteCode?: string }) {
    const wanted = t.inviteCode?.trim().toUpperCase();
    const taken = !wanted || [...this.trips.values()].some((x) => x.inviteCode === wanted);
    const inviteCode = taken ? this.freshCode() : wanted!;
    this.reserved.delete(inviteCode);
    const trip: Trip = { ...t, id: randomUUID(), inviteCode };
    this.trips.set(trip.id, trip);
    return trip;
  }
  async getTrip(id: string) { return this.trips.get(id) ?? null; }
  async getTripByCode(code: string) {
    return [...this.trips.values()].find((t) => t.inviteCode.toLowerCase() === code.trim().toLowerCase()) ?? null;
  }
  async joinTrip(code: string, name: string, email?: string) {
    const trip = await this.getTripByCode(code);
    if (!trip) return null;
    const invited = trip.people.find((p) => p.status === "invited" && p.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (invited) { // claim the invited person instead of adding a duplicate
      invited.status = "joined";
      if (email) invited.email = email;
    } else {
      trip.people.push({ id: randomUUID(), name, email, isMe: false, status: "joined" });
    }
    return trip;
  }
  async listExpenses(tripId: string) { return this.expenses.filter((e) => e.tripId === tripId); }
  async addExpense(e: NewExpense) {
    const saved: Expense = { ...e, id: randomUUID(), createdAt: new Date().toISOString() };
    this.expenses.push(saved);
    return saved;
  }
}
