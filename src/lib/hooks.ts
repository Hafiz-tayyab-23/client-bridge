"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

/** Loads a GET endpoint, optionally polling; refreshes on the global "app:refresh" event (realtime poll). */
export function useApi<T>(path: string | null, opts: { pollMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const pathRef = useRef(path);

  const reload = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const r = await api<T>(p);
      if (pathRef.current === p) { setData(r); setError(null); }
    } catch (e) {
      if (pathRef.current === p) setError(e as Error);
    } finally {
      if (pathRef.current === p) setLoading(false);
    }
  }, []);

  useEffect(() => {
    pathRef.current = path;
    if (!path) { setData(null); setLoading(false); return; }
    setLoading(true);
    reload();
    const onRefresh = () => reload();
    window.addEventListener("app:refresh", onRefresh);
    const t = opts.pollMs ? setInterval(() => { if (document.visibilityState === "visible") reload(); }, opts.pollMs) : undefined;
    return () => { window.removeEventListener("app:refresh", onRefresh); if (t) clearInterval(t); };
  }, [path, opts.pollMs, reload]);

  return { data, error, loading, reload, setData };
}

export const refreshAll = () => window.dispatchEvent(new CustomEvent("app:refresh"));
