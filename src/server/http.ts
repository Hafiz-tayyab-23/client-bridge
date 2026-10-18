import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

/** Errors thrown by services; mapped to HTTP responses in one place. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const unauthorized = (m = "Please sign in.") => new AppError(401, "unauthorized", m);
export const forbidden = (m = "You do not have permission to do this.") => new AppError(403, "forbidden", m);
export const notFound = (m = "Not found.") => new AppError(404, "not_found", m);
export const badRequest = (m: string, details?: unknown) => new AppError(400, "bad_request", m, details);
export const conflict = (m: string, details?: unknown) => new AppError(409, "conflict", m, details);

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * CSRF defence for cookie-authenticated mutations: the Origin (or Referer) must be this site.
 * Combined with SameSite=Lax cookies and JSON-only bodies.
 */
function checkOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) throw forbidden("Missing request origin.");
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw forbidden("Invalid request origin.");
  }
  const allowed = new Set([req.headers.get("x-forwarded-host"), req.headers.get("host")].filter(Boolean));
  if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).host);
  if (!allowed.has(host)) throw forbidden("Cross-site request blocked.");
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/** Wraps a route handler: CSRF check (unless `public webhook`), error mapping, no-store. */
export function route<C>(handler: Handler<C>, opts: { csrf?: boolean } = {}): Handler<C> {
  return async (req, ctx) => {
    try {
      if (opts.csrf !== false) checkOrigin(req);
      return await handler(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) {
    return json({ error: { code: e.code, message: e.message, details: e.details } }, e.status);
  }
  if (e instanceof z.ZodError) {
    return json(
      {
        error: {
          code: "validation",
          message: "Some fields are invalid.",
          details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      400,
    );
  }
  const pg = e as { code?: string; constraint_name?: string };
  if (pg?.code === "23505") {
    return json({ error: { code: "duplicate", message: "That value is already in use.", details: pg.constraint_name } }, 409);
  }
  if (pg?.code === "22P02") return json({ error: { code: "not_found", message: "Not found." } }, 404);
  console.error(e);
  return json({ error: { code: "server_error", message: "Something went wrong. Please try again." } }, 500);
}

export async function readJson<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw badRequest("Expected a JSON body.");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Malformed JSON body.");
  }
  return schema.parse(body);
}

export const uuid = z.string().uuid();
export function parseId(v: string): string {
  const r = uuid.safeParse(v);
  if (!r.success) throw notFound();
  return r.data;
}

export function clientIp(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}
