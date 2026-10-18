// Browser-side API client. Presentation code calls only these JSON endpoints.
export interface ApiErrorBody { code: string; message: string; details?: unknown }
export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(body.message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, { code: "network", message: "Could not reach the server. Check your connection and try again." });
  }
  const data = await res.json().catch(() => ({}));
  // Session expired or revoked: send the user to sign in (except on auth endpoints themselves).
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/") && !location.pathname.startsWith("/login")) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? { code: "http_" + res.status, message: `Request failed (${res.status}). Please try again.` });
  return data as T;
}

export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !Array.isArray(e.body.details)) return {};
  return Object.fromEntries((e.body.details as { path: string; message: string }[]).map((d) => [d.path, d.message]));
}
