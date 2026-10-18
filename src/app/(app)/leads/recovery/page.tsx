"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Notice } from "@/components/temp/ui";

interface Item { id: string; title: string; owner_name: string | null; status: string; escalation_count: number; reasons: string[] }

export default function RecoveryPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () => api<{ items: Item[] }>("/api/leads/recovery").then((r) => setItems(r.items)).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Recovery queue</h1>
      {error && <Notice kind="error">{error}</Notice>}
      {!items ? <p role="status">Loading…</p> : items.length === 0 ? <p>Nothing needs recovery right now.</p> : (
        <ul className="flex flex-col gap-2">
          {items.map((i) => (
            <li key={i.id} className="rounded border bg-white p-3 text-sm">
              <Link className="font-semibold underline" href={`/leads/${i.id}`}>{i.title}</Link> — owner {i.owner_name ?? "—"} — {i.status}
              <ul className="list-disc pl-5">{i.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
