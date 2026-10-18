import { route, json } from "@/server/http";
import { sql } from "@/server/db";

export const GET = route(async () => {
  const [r] = await sql`select now() as db_time, (select max(name) from schema_migrations) as migration`;
  return json({ ok: true, dbTime: r.db_time, migration: r.migration });
});
