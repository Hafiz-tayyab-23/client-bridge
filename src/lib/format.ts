export function money(cents: number | string | null | undefined, currency = "pkr") {
  if (cents === null || cents === undefined) return "Hidden";
  const n = Number(cents) / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function dateTime(iso: string | null | undefined, tz?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });
}

export function ago(iso: string | null | undefined) {
  if (!iso) return "—";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.max(0, s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function duration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const sourceLabel = (s: string) => ({ web_form: "Web form", message: "Telegram message", manual: "Manual entry" })[s] ?? s;
export const availLabel = (s: string) => ({ available: "Available", busy: "Busy", on_leave: "On leave", offline: "Offline" })[s] ?? s;
