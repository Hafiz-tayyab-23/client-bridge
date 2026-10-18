import type { NextRequest } from "next/server";
import { route, json, unauthorized } from "@/server/http";
import { safeEqual } from "@/server/crypto";
import { sql } from "@/server/db";
import { runTick } from "@/server/worker";

// Called by Supabase pg_cron every 5 s with Authorization: Bearer <secret>.
// Accepts the database-held secret (worker_state.secret, read by the cron job itself)
// or the optional WORKER_SECRET env var.
async function handle(req: NextRequest) {
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!given) throw unauthorized("Missing worker secret.");
  const env = (process.env.WORKER_SECRET ?? "").trim().replace(/^["']|["']$/g, "");
  let ok = Boolean(env) && safeEqual(given, env);
  if (!ok) {
    const [w] = await sql<{ secret: string }[]>`select secret from worker_state where id = 1`;
    ok = Boolean(w?.secret) && safeEqual(given, w.secret);
  }
  if (!ok) throw unauthorized("Invalid worker secret.");
  return json(await runTick(1));
}
export const POST = route(handle, { csrf: false });
export const GET = route(handle, { csrf: false });
