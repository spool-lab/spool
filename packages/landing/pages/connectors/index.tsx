import { useEffect } from "react";

export default function ConnectorsRedirect() {
  useEffect(() => {
    window.location.replace("/daemon");
  }, []);
  return (
    <main className="wrap" style={{ padding: "120px 24px", textAlign: "center" }}>
      <p style={{ color: "var(--muted)", fontSize: 14 }}>
        Connectors moved. Redirecting to <a href="/daemon" style={{ color: "var(--accent)" }}>/daemon</a>…
      </p>
    </main>
  );
}
