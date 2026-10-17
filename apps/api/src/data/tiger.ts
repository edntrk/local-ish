/**
 * DATA role: real database (Tiger Data = PostgreSQL).
 * Status: DRAFT, not yet run against a real database. Tables are in db/schema.sql.
 * Turn on with DATA_MODE=tiger and DATABASE_URL in .env.
 * Rule: keep every method returning exactly what the DataStore port promises.
 * Run `npm test` before you push. The same contract tests run against this class when DATABASE_URL is set.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import type { Expense, NewExpense, PriceItem, Trip } from "@fairfare/shared";
import type { DataStore } from "../ports";

const rowToPrice = (r: any): PriceItem => ({
  id: r.id, city: r.city, category: r.category, name: r.name, min: Number(r.min_price), max: Number(r.max_price),
  currency: r.currency, tip: r.tip, source: r.source ?? undefined, checkedOn: r.checked_on ? String(r.checked_on).slice(0, 10) : undefined,
});

export class TigerDataStore implements DataStore {
  private pool: pg.Pool;
  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url }); }

  async listPrices(city: string) {
    const { rows } = await this.pool.query("select * from price_items where city = $1 order by category, name", [city]);
    return rows.map(rowToPrice);
  }
  async getPrice(city: string, itemId: string) {
    const { rows } = await this.pool.query("select * from price_items where city = $1 and id = $2", [city, itemId]);
    return rows[0] ? rowToPrice(rows[0]) : null;
  }
  async createTrip(t: Omit<Trip, "id" | "inviteCode">) {
    const id = randomUUID();
    const inviteCode = "MRK-" + Math.random().toString(36).slice(2, 7).toUpperCase();
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await c.query(
        `insert into trips (id, city, currency, home_currency, rate_to_local, budget_home, start_date, end_date, invite_code)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, t.city, t.currency, t.homeCurrency, t.rateToLocal, t.budgetHome, t.start, t.end, inviteCode],
      );
      for (const p of t.people) {
        await c.query("insert into people (id, trip_id, name, email, is_me, status) values ($1,$2,$3,$4,$5,$6)", [p.id, id, p.name, p.email ?? null, p.isMe, p.status]);
      }
      await c.query("commit");
    } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
    return (await this.getTrip(id))!;
  }
  async getTrip(tripId: string) {
    const { rows } = await this.pool.query("select * from trips where id = $1", [tripId]);
    if (!rows[0]) return null;
    const t = rows[0];
    const people = await this.pool.query("select * from people where trip_id = $1 order by is_me desc, name", [tripId]);
    return {
      id: t.id, city: t.city, currency: t.currency, homeCurrency: t.home_currency, rateToLocal: Number(t.rate_to_local),
      budgetHome: Number(t.budget_home), start: String(t.start_date).slice(0, 10), end: String(t.end_date).slice(0, 10), inviteCode: t.invite_code,
      people: people.rows.map((p) => ({ id: p.id, name: p.name, email: p.email ?? undefined, isMe: p.is_me, status: p.status })),
    } satisfies Trip;
  }
  async joinTrip(code: string, name: string, email?: string) {
    const { rows } = await this.pool.query("select id from trips where invite_code = $1", [code]);
    if (!rows[0]) return null;
    await this.pool.query("insert into people (id, trip_id, name, email, is_me, status) values ($1,$2,$3,$4,false,'joined')", [randomUUID(), rows[0].id, name, email ?? null]);
    return this.getTrip(rows[0].id);
  }
  async listExpenses(tripId: string) {
    const { rows } = await this.pool.query("select * from expenses where trip_id = $1 order by created_at", [tripId]);
    return rows.map((r): Expense => ({
      id: r.id, tripId: r.trip_id, item: r.item, category: r.category, amount: Number(r.amount), paidBy: r.paid_by,
      shares: Object.fromEntries(Object.entries(r.shares as Record<string, unknown>).map(([k, v]) => [k, Number(v)])),
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }
  async addExpense(e: NewExpense) {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      "insert into expenses (id, trip_id, item, category, amount, paid_by, shares) values ($1,$2,$3,$4,$5,$6,$7) returning created_at",
      [id, e.tripId, e.item, e.category, e.amount, e.paidBy, JSON.stringify(e.shares)],
    );
    return { ...e, id, createdAt: new Date(rows[0].created_at).toISOString() };
  }
}
