import { Layers } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth" id="main">
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div className="brand">
          <span className="logo"><Layers size={18} /></span>
          <div><b>LeadGuard</b><small>Every lead has one accountable owner</small></div>
        </div>
        <section className="card"><div className="cb" style={{ padding: 24 }}>{children}</div></section>
      </div>
    </main>
  );
}
