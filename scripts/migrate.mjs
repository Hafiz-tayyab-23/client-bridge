// Applies db/migrations/*.sql in order, once each.
// Usage: npm run db:migrate            (reads .env)
//        npm run db:migrate:cloud      (reads .env.cloud)
import dotenv from "dotenv";
import postgres from "postgres";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const envArg = process.argv.find((a) => a.startsWith("--env="));
dotenv.config({ path: envArg ? envArg.slice(6) : ".env", quiet: true });
const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL (or DATABASE_URL_DIRECT) is not set. See .env.example.");
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const sql = postgres(url, { max: 1, prepare: false, ssl: local ? false : "require", onnotice: () => {} });
console.log(`target: ${new URL(url).hostname}:${new URL(url).port || 5432}`);
const dir = join(process.cwd(), "db", "migrations");

try {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    process.stdout.write(`applying ${f} ... `);
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, f), "utf8"));
      await tx`insert into schema_migrations (name) values (${f})`;
    });
    console.log("ok");
  }
  console.log("migrations up to date");
} catch (e) {
  console.error("\nmigration failed:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
