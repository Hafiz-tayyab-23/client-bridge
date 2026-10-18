export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth" id="main">
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <img src="/clientbridge-logo.png" alt="ClientBridge" width={180} height={180} style={{ display: "inline-block" }} />
          <p className="faint">Every lead has one accountable owner</p>
        </div>
        <section className="card"><div className="cb" style={{ padding: 24 }}>{children}</div></section>
      </div>
    </main>
  );
}
