import { useState } from "react";
import {
  WebphoneProvider,
  Dialer,
  useSipActions,
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

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const CORNERS: Corner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

type Contact = {
  id: number;
  name: string;
  company: string;
  phone: string;
  email: string;
  status: "Lead" | "Customer" | "Trial";
};

const CONTACTS: Contact[] = [
  { id: 1, name: "Amanda Henderson", company: "Brightside Studio", phone: "+254 712 345 678", email: "amanda@brightside.test", status: "Customer" },
  { id: 2, name: "David Kimani", company: "Northstar Logistics", phone: "+254 722 481 903", email: "david@northstar.test", status: "Lead" },
  { id: 3, name: "Nia Wanjiku", company: "Nia & Co.", phone: "+254 733 105 224", email: "nia@niaco.test", status: "Trial" },
  { id: 4, name: "Paul Otieno", company: "Kijani Foods", phone: "+254 701 892 451", email: "paul@kijani.test", status: "Customer" },
];

function CallButton({ phone, compact = false }: { phone: string; compact?: boolean }) {
  const actions = useSipActions();
  const [calling, setCalling] = useState(false);

  const call = async () => {
    if (!actions || calling) return;
    setCalling(true);
    try {
      await actions.startCall(phone.replace(/\s/g, ""));
    } finally {
      setCalling(false);
    }
  };

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void call();
      }}
      disabled={!actions || calling}
      style={{
        border: 0,
        borderRadius: 8,
        padding: compact ? "7px 10px" : "9px 13px",
        background: "#0f766e",
        color: "white",
        fontSize: 12,
        fontWeight: 650,
        cursor: actions && !calling ? "pointer" : "not-allowed",
        opacity: actions ? 1 : 0.55,
      }}
    >
      {calling ? "Calling…" : compact ? "Call" : "Call contact"}
    </button>
  );
}

function ContactsWorkspace() {
  const [selectedContactId, setSelectedContactId] = useState(CONTACTS[0].id);
  const selected = CONTACTS.find((contact) => contact.id === selectedContactId) ?? CONTACTS[0];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 20, maxWidth: 1120, margin: "28px auto", padding: "0 24px" }}>
      <section style={{ overflow: "hidden", border: "1px solid #e2e8f0", borderRadius: 12, background: "white" }}>
        <div style={{ padding: "18px 20px", borderBottom: "1px solid #e2e8f0" }}>
          <h1 style={{ margin: 0, fontSize: 18, color: "#1e293b" }}>Contacts</h1>
          <p style={{ margin: "5px 0 0", fontSize: 13, color: "#64748b" }}>A CRM-style table. Every phone action calls through <code>useSipActions()</code>.</p>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#f8fafc", color: "#64748b", textAlign: "left" }}>
            {['Contact', 'Company', 'Phone', 'Status', ''].map((heading) => <th key={heading} style={{ padding: "11px 16px", fontSize: 11, fontWeight: 650 }}>{heading}</th>)}
          </tr></thead>
          <tbody>{CONTACTS.map((contact) => {
            const selectedRow = contact.id === selected.id;
            return <tr key={contact.id} onClick={() => setSelectedContactId(contact.id)} style={{ cursor: "pointer", background: selectedRow ? "#f0fdfa" : "white" }}>
              <td style={{ padding: "14px 16px", borderTop: "1px solid #f1f5f9", fontWeight: 650, color: "#1e293b" }}>{contact.name}</td>
              <td style={{ padding: "14px 16px", borderTop: "1px solid #f1f5f9", color: "#475569" }}>{contact.company}</td>
              <td style={{ padding: "14px 16px", borderTop: "1px solid #f1f5f9", color: "#475569" }}>{contact.phone}</td>
              <td style={{ padding: "14px 16px", borderTop: "1px solid #f1f5f9" }}><span style={{ borderRadius: 999, padding: "4px 8px", background: "#e2e8f0", color: "#475569", fontSize: 11 }}>{contact.status}</span></td>
              <td style={{ padding: "10px 16px", borderTop: "1px solid #f1f5f9", textAlign: "right" }}><CallButton phone={contact.phone} compact /></td>
            </tr>;
          })}</tbody>
        </table>
      </section>

      <aside style={{ alignSelf: "start", border: "1px solid #e2e8f0", borderRadius: 12, background: "white", padding: 20 }}>
        <p style={{ margin: 0, color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>Contact details</p>
        <h2 style={{ margin: "10px 0 4px", fontSize: 19, color: "#1e293b" }}>{selected.name}</h2>
        <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>{selected.company}</p>
        <dl style={{ margin: "22px 0", display: "grid", gap: 14, fontSize: 13 }}>
          <div><dt style={{ color: "#94a3b8", fontSize: 11 }}>EMAIL</dt><dd style={{ margin: "4px 0 0", color: "#334155" }}>{selected.email}</dd></div>
          <div><dt style={{ color: "#94a3b8", fontSize: 11 }}>PHONE</dt><dd style={{ margin: "6px 0 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, color: "#334155" }}><span>{selected.phone}</span><CallButton phone={selected.phone} /></dd></div>
        </dl>
      </aside>
    </div>
  );
}

export default function App() {
  const [credentials, setCredentials] = useState<SipCredentialsInput | null>(
    ENV_DEFAULTS.sipUsername ? ENV_DEFAULTS : null
  );
  const [draggable, setDraggable] = useState(true);
  const [corner, setCorner] = useState<Corner>("bottom-right");

  return (
    <div style={{ minHeight: "100vh", background: "#fafafa" }}>
      {/* A deliberately ordinary host application: no special webphone UI is
          needed for click-to-call cells or a CRM contact panel. */}
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h2 style={{ fontSize: 16, color: "#333" }}>Host application</h2>
        <p style={{ fontSize: 13, color: "#777" }}>
          The Dialer should float over this content without permanently covering it - drag it
          around to confirm.
        </p>

        {credentials ? (
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 12 }}>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={draggable}
                onChange={(event) => setDraggable(event.target.checked)}
              />
              Draggable
            </label>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              {draggable ? "Starting corner" : "Fixed corner"}
              <select
                value={corner}
                onChange={(event) => setCorner(event.target.value as Corner)}
                style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc" }}
              >
                {CORNERS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </div>

      {credentials ? (
        <WebphoneProvider
          credentials={credentials}
          onRegistrationFailed={(cause) => console.warn("Registration failed:", cause)}
        >
          <ContactsWorkspace />
          <Dialer draggable={draggable} corner={corner} />
        </WebphoneProvider>
      ) : (
        <CredentialsForm onSubmit={setCredentials} />
      )}
    </div>
  );
}
