"use client";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { useMe } from "@/components/shell/app-shell";
import { Note, PageHead } from "@/components/ui/primitives";

// Placeholder until the dashboard endpoint lands (F5). No figures are shown rather than fake ones.
export default function Dashboard() {
  const me = useMe();
  return (
    <>
      <PageHead title="Operational Dashboard" sub={`Welcome, ${me.user.name}.`} />
      <section className="card"><div className="cb">
        <div className="row"><span className="ico"><LayoutDashboard size={16} /></span><b>Live metrics are being connected.</b></div>
        <div style={{ marginTop: 12 }}><Note>Meanwhile, open <Link className="link" href="/leads">Leads</Link> or the <Link className="link" href="/leads?state=recovery">recovery queue</Link>.</Note></div>
      </div></section>
    </>
  );
}
