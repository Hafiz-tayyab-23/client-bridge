import "server-only";
import postgres from "postgres";

// Data access: one pooled client per server instance. `prepare: false` keeps it
// compatible with the Supabase transaction pooler used on serverless hosting.
type Sql = postgres.Sql;
const g = globalThis as unknown as { __sql?: Sql };

function create(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return postgres(url, {
    max: process.env.VERCEL ? 3 : 10,
    prepare: false, // required by Supabase's transaction pooler (no prepared statements)
    ssl: local ? false : "require",
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    // int8 (money in cents, bigserial ids) as JS numbers; all values stay far below 2^53.
    types: { bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) } },
  });
}

export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  get(_t, prop) {
    g.__sql ??= create();
    const v = (g.__sql as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(g.__sql) : v;
  },
  apply(_t, _this, args) {
    g.__sql ??= create();
    return (g.__sql as unknown as (...a: unknown[]) => unknown)(...args);
  },
}) as Sql;

export type Tx = postgres.TransactionSql;
export type Db = Sql | Tx;
