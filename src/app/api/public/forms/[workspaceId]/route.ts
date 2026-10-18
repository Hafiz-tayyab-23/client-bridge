import type { NextRequest } from "next/server";
import { z } from "zod";
import { route, json, readJson, parseId, clientIp, AppError, notFound } from "@/server/http";
import { sql } from "@/server/db";
import { captureLead, LeadIntakeInput } from "@/server/services/leads";

// Public web form intake (F3.1). No session; rate-limited per IP; honeypot field "website".
export const POST = route(async (req: NextRequest, ctx: RouteContext<"/api/public/forms/[workspaceId]">) => {
  const workspaceId = parseId((await ctx.params).workspaceId);
  const [ws] = await sql`select id from workspaces where id = ${workspaceId}`;
  if (!ws) throw notFound("Form not found.");
  const ip = clientIp(req);
  const [{ n }] = await sql`select count(*)::int as n from leads where workspace_id = ${workspaceId}
    and source = 'web_form' and source_detail = ${"ip:" + ip} and created_at > now() - interval '10 minutes'`;
  if (n >= 10) throw new AppError(429, "rate_limited", "Too many submissions. Please try again later.");
  const body = await readJson(req, LeadIntakeInput.and(z.object({ website: z.string().max(0).optional() })));
  const { website: _hp, ...input } = body;
  const r = await captureLead(workspaceId, "web_form", { ...input, sourceDetail: "ip:" + ip }, null);
  return json({ ok: true, reference: r.leadId.slice(0, 8) }, 201);
}, { csrf: false });
