import type { NextRequest } from "next/server";
import { route, json, unauthorized } from "@/server/http";
import { safeEqual } from "@/server/crypto";
import { runTick } from "@/server/worker";

// Called by Supabase pg_cron every few seconds: Authorization: Bearer <WORKER_SECRET>.
async function handle(req: NextRequest) {
  const secret = process.env.WORKER_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !safeEqual(given, secret)) throw unauthorized("Invalid worker secret.");
  return json(await runTick(1));
}
export const POST = route(handle, { csrf: false });
export const GET = route(handle, { csrf: false });
