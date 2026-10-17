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

const CATS = "'transport','food','activities','shopping','stay','essentials','other'";
/** Moves old rows to the fixed category list and re-creates the CHECK constraints. Safe to re-run; db/schema.sql has the same steps. */
export const CATEGORY_MIGRATION = [
  "alter table price_items drop constraint if exists price_items_category_check",
  "alter table expenses drop constraint if exists expenses_category_check",
  "update price_items set category = 'essentials' where category = 'sim'",
  "update expenses set category = 'essentials' where category = 'sim'",
  "update price_items set category = 'activities' where category in ('shopping','other') and (id ~* '(surf-lesson|massage)' or name ~* '(surf lesson|massage)')",
  "update expenses set category = 'activities' where category in ('shopping','other') and item ~* '(surf lesson|massage)'",
  `update price_items set category = 'other' where category not in (${CATS})`,
  `update expenses set category = 'other' where category not in (${CATS})`,
  `alter table price_items add constraint price_items_category_check check (category in (${CATS}))`,
  `alter table expenses add constraint expenses_category_check check (category in (${CATS}))`,
];

const rowToPrice = (r: any): PriceItem => ({
  id: r.id, city: r.city, category: r.category, name: r.name, min: Number(r.min_price), max: Number(r.max_price),
  currency: r.currency, tip: r.tip, source: r.source ?? undefined, checkedOn: r.checked_on ? String(r.checked_on).slice(0, 10) : undefined,
  origin: r.origin === "web" ? "web" : "seed",
  bargain: r.bargain ?? undefined,
});

export class TigerDataStore implements DataStore {
  private pool: pg.Pool;
  constructor(url: string) {
    // node-pg reads sslmode=require as "verify the whole certificate chain", and Tiger Cloud's chain fails that
    // (SELF_SIGNED_CERT_IN_CHAIN). uselibpqcompat gives the standard libpq meaning of "require": encrypted, chain not verified.
    const compat = /sslmode=(require|prefer)/.test(url) && !/uselibpqcompat=/.test(url) ? url + (url.includes("?") ? "&" : "?") + "uselibpqcompat=true" : url;
    this.pool = new pg.Pool({ connectionString: compat });
  }

  async listPrices(city: string) {
    const { rows } = await this.pool.query("select * from price_items where city = $1 order by category, name", [city]);
    return rows.map(rowToPrice);
  }
  /** Safe to run on every start: adds the columns newer code needs. */
  async init() {
    await this.pool.query("alter table price_items add column if not exists origin text not null default 'seed'");
    await this.pool.query("alter table trips add column if not exists group_budget_home numeric(12,2)");
    await this.pool.query("alter table price_items add column if not exists bargain text check (bargain in ('bargain','ask','fixed'))");
    // rows saved before the column existed: the two named in the brief get their usual mode, the rest fall back by category in code
    await this.pool.query("update price_items set bargain = 'bargain' where bargain is null and id ~* 'surf-lesson'");
    await this.pool.query("update price_items set bargain = 'ask' where bargain is null and id ~* 'massage'");
    for (const sql of CATEGORY_MIGRATION) await this.pool.query(sql); // the fixed category list; safe to re-run
  }
  async addPriceItem(item: PriceItem) {
    // new slug: insert. Existing slug: seed rows are never touched; a web row is refreshed only when it is over 30 days old.
    await this.pool.query(
      `insert into price_items (id, city, category, name, min_price, max_price, currency, tip, source, checked_on, origin, bargain)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'web',$11)
       on conflict (city, id) do update set name = excluded.name, category = excluded.category, min_price = excluded.min_price, max_price = excluded.max_price,
         tip = excluded.tip, source = excluded.source, checked_on = excluded.checked_on, bargain = excluded.bargain
       where price_items.origin = 'web' and price_items.checked_on < current_date - 30`,
      [item.id, item.city, item.category, item.name, item.min, item.max, item.currency, item.tip, item.source ?? null, item.checkedOn ?? new Date().toISOString().slice(0, 10), item.bargain ?? null],
    );
    return (await this.getPrice(item.city, item.id))!;
  }
  async getPrice(city: string, itemId: string) {
    const { rows } = await this.pool.query("select * from price_items where city = $1 and id = $2", [city, itemId]);
    return rows[0] ? rowToPrice(rows[0]) : null;
  }
  private async freshCode() {
    for (;;) {
      const code = "BAL-" + Math.random().toString(36).slice(2, 7).toUpperCase();
      const { rows } = await this.pool.query("select 1 from trips where invite_code = $1", [code]);
      if (!rows[0]) return code;
    }
  }
  async reserveInviteCode() { return this.freshCode(); } // random and checked against existing trips; no reservation table needed
  async createTrip(t: Omit<Trip, "id" | "inviteCode"> & { inviteCode?: string }) {
    const id = randomUUID();
    const wanted = t.inviteCode?.trim().toUpperCase();
    const taken = wanted ? (await this.pool.query("select 1 from trips where invite_code = $1", [wanted])).rows.length > 0 : true;
    const inviteCode = taken ? await this.freshCode() : wanted!;
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await c.query(
        `insert into trips (id, city, currency, home_currency, rate_to_local, budget_home, group_budget_home, start_date, end_date, invite_code)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, t.city, t.currency, t.homeCurrency, t.rateToLocal, t.budgetHome, t.groupBudgetHome ?? null, t.start, t.end, inviteCode],
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
      budgetHome: Number(t.budget_home), groupBudgetHome: t.group_budget_home != null ? Number(t.group_budget_home) : undefined, start: String(t.start_date).slice(0, 10), end: String(t.end_date).slice(0, 10), inviteCode: t.invite_code,
      people: people.rows.map((p) => ({ id: p.id, name: p.name, email: p.email ?? undefined, isMe: p.is_me, status: p.status })),
    } satisfies Trip;
  }
  async getTripByCode(code: string) {
    const { rows } = await this.pool.query("select id from trips where lower(invite_code) = lower($1)", [code.trim()]);
    return rows[0] ? this.getTrip(rows[0].id) : null;
  }
  async joinTrip(code: string, name: string, email?: string) {
    const { rows } = await this.pool.query("select id from trips where lower(invite_code) = lower($1)", [code.trim()]);
    if (!rows[0]) return null;
    // an "invited" person with the same name (any capitals) is claimed instead of duplicated
    const claimed = await this.pool.query(
      `update people set status = 'joined', email = coalesce($3, email)
       where id = (select id from people where trip_id = $1 and status = 'invited' and lower(trim(name)) = lower(trim($2)) limit 1)`,
      [rows[0].id, name, email ?? null],
    );
    if (!claimed.rowCount) {
      await this.pool.query("insert into people (id, trip_id, name, email, is_me, status) values ($1,$2,$3,$4,false,'joined')", [randomUUID(), rows[0].id, name, email ?? null]);
    }
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
