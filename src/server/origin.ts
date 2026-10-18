import "server-only";
import { headers } from "next/headers";

/** Public base URL of this deployment: from the current request when available, else APP_URL. */
export async function appOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
      return `${proto.split(",")[0]}://${host.split(",")[0]}`;
    }
  } catch {
    /* outside a request scope */
  }
  return (process.env.APP_URL ?? "http://localhost:3000").trim().replace(/^["']|["']$/g, "").replace(/\/$/, "");
}
