import "server-only";
import postgres from "postgres";

// Data access: one pooled client per server instance. `prepare: false` keeps it
// compatible with the Supabase transaction pooler used on serverless hosting.
//
// Serverless instances are frozen between requests; sockets opened before a freeze can be dead
// afterwards, and a query sent on a dead socket waits indefinitely. So on Vercel, a client that has
// been idle for more than IDLE_RECYCLE_MS is retired (gracefully, letting in-flight queries finish)
// and a fresh one is created for the next request.
type Sql = postgres.Sql;
const g = globalThis as unknown as { __sql?: Sql; __sqlLastUse?: number };
const SERVERLESS = Boolean(process.env.VERCEL);
const IDLE_RECYCLE_MS = 2000;

function create(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return postgres(url, {
    max: SERVERLESS ? 2 : 10, // keep serverless instances light on the free-tier pooler
    prepare: false, // required by Supabase's transaction pooler (no prepared statements)
    ssl: local ? false : "require",
    idle_timeout: SERVERLESS ? 5 : 20,
    max_lifetime: SERVERLESS ? 60 : 60 * 30,
    connect_timeout: 10,
    connection: { statement_timeout: 15000 },
    onnotice: () => {},
    // int8 (money in cents, bigserial ids) as JS numbers; all values stay far below 2^53.
    types: { bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) } },
  });
}

function client(): Sql {
  const now = Date.now();
  if (g.__sql && SERVERLESS && g.__sqlLastUse && now - g.__sqlLastUse > IDLE_RECYCLE_MS) {
    const old = g.__sql;
    g.__sql = undefined;
    old.end({ timeout: 5 }).catch(() => {});
  }
  g.__sql ??= create();
  g.__sqlLastUse = now;
  return g.__sql;
}

export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  get(_t, prop) {
    const c = client();
    const v = (c as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
  apply(_t, _this, args) {
    return (client() as unknown as (...a: unknown[]) => unknown)(...args);
  },
}) as Sql;

export type Tx = postgres.TransactionSql;
export type Db = Sql | Tx;
