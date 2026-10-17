import { randomUUID } from "node:crypto";
import type { Expense, NewExpense, Trip } from "@fairfare/shared";
import type { DataStore } from "../ports";
import { SEED_PRICES } from "./seed-prices";

/** In-memory store. Works with no database, resets when the server restarts. */
export class MockDataStore implements DataStore {
  private trips = new Map<string, Trip>();
  private expenses: Expense[] = [];

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

  async createTrip(t: Omit<Trip, "id" | "inviteCode">) {
    const trip: Trip = { ...t, id: randomUUID(), inviteCode: "BAL-" + Math.random().toString(36).slice(2, 7).toUpperCase() };
    this.trips.set(trip.id, trip);
    return trip;
  }
  async getTrip(id: string) { return this.trips.get(id) ?? null; }
  async joinTrip(code: string, name: string, email?: string) {
    const trip = [...this.trips.values()].find((t) => t.inviteCode === code);
    if (!trip) return null;
    trip.people.push({ id: randomUUID(), name, email, isMe: false, status: "joined" });
    return trip;
  }
  async listExpenses(tripId: string) { return this.expenses.filter((e) => e.tripId === tripId); }
  async addExpense(e: NewExpense) {
    const saved: Expense = { ...e, id: randomUUID(), createdAt: new Date().toISOString() };
    this.expenses.push(saved);
    return saved;
  }
}
