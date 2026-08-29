import { useState } from "react";
import {
  WebphoneProvider,
  Dialer,
  type SipCredentialsInput,
} from "@telvoip/webphone-react";

// Pre-fill from Vite env vars if present (see .env.example) - convenient for
// pointing this at a real Telvoip staging account without hardcoding
// secrets into the example. Falls back to an empty form otherwise.
const ENV_DEFAULTS: SipCredentialsInput = {
  sipUsername: import.meta.env.VITE_SIP_USERNAME ?? "",
  sipPassword: import.meta.env.VITE_SIP_PASSWORD ?? "",
  sipWsUrl: import.meta.env.VITE_SIP_WSS_URL ?? "",
  sipDomain: import.meta.env.VITE_SIP_DOMAIN ?? "",
};

function CredentialsForm({ onSubmit }: { onSubmit: (creds: SipCredentialsInput) => void }) {
  const [form, setForm] = useState(ENV_DEFAULTS);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(form);
      }}
      style={{
        maxWidth: 420,
        margin: "80px auto",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>@telvoip/webphone-react example</h1>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
        Enter SIP credentials to connect. If you're a Telvoip Developer-kind account, get these
        from <code>GET /api/developers/voice/credentials</code> (see the API's docs at{" "}
        <code>/api/developers/docs</code>).
      </p>
      {(
        [
          ["sipUsername", "SIP username", "text"],
          ["sipPassword", "SIP password", "password"],
          ["sipWsUrl", "WSS URL", "text"],
          ["sipDomain", "SIP domain (optional)", "text"],
        ] as const
      ).map(([key, label, type]) => (
        <label key={key} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          {label}
          <input
            type={type}
            value={form[key] ?? ""}
            onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
            placeholder={key === "sipWsUrl" ? "wss://app.telvoip.io:7443" : undefined}
            style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #ccc" }}
          />
        </label>
      ))}
      <button
        type="submit"
        disabled={!form.sipUsername || !form.sipPassword || !form.sipWsUrl}
        style={{
          marginTop: 8,
          padding: "10px 14px",
          borderRadius: 6,
          border: "none",
          background: "#2563eb",
          color: "white",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Connect
      </button>
    </form>
  );
}

export default function App() {
  const [credentials, setCredentials] = useState<SipCredentialsInput | null>(
    ENV_DEFAULTS.sipUsername ? ENV_DEFAULTS : null
  );

  return (
    <div style={{ minHeight: "100vh", background: "#fafafa" }}>
      {/* Deliberately plain, framework-free page content around the widget -
          this is exactly what "drop it into any React app" needs to prove. */}
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h2 style={{ fontSize: 16, color: "#333" }}>Host application</h2>
        <p style={{ fontSize: 13, color: "#777" }}>
          The Dialer should float over this content without permanently covering it - drag it
          around to confirm.
        </p>
      </div>

      {credentials ? (
        <WebphoneProvider
          credentials={credentials}
          onRegistrationFailed={(cause) => console.warn("Registration failed:", cause)}
        >
          <Dialer />
        </WebphoneProvider>
      ) : (
        <CredentialsForm onSubmit={setCredentials} />
      )}
    </div>
  );
}
