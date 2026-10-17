// Data role: creates the tables and loads sample prices into DATABASE_URL.
// Run with:  npm run db:setup
import "dotenv/config";
import { readFile } from "node:fs/promises";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL in .env first."); process.exit(1); }
const client = new pg.Client({ connectionString: url });
await client.connect();
for (const f of ["db/schema.sql", "db/seed.sql"]) {
  await client.query(await readFile(f, "utf8"));
  console.log("ran", f);
}
await client.end();
