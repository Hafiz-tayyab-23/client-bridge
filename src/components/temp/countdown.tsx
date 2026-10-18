"use client";
import { useEffect, useState } from "react";

/** Remaining acknowledgement time (F3.4). Corrects for client clock skew using server time. */
export function Countdown({ deadline, serverTime }: { deadline: string; serverTime: string }) {
  const [skew] = useState(() => Date.parse(serverTime) - Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.round((Date.parse(deadline) - (now + skew)) / 1000);
  if (left <= 0) return <span className="font-semibold text-red-800">Overdue — escalating</span>;
  const m = Math.floor(left / 60), s = left % 60;
  return <span aria-label={`${m} minutes ${s} seconds left`} className="tabular-nums">⏱ {m}:{String(s).padStart(2, "0")}</span>;
}
