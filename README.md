# @telvoip/webphone-react

A portable React hook and drop-in `<Dialer />` component for WebRTC/SIP softphones, built on
[JsSIP](https://jssip.net) and tested against real production call traffic — packaged for any
React project to use.

> **Status: pre-release.** The engine and UI are built and wired together; not yet published to
> npm. See the roadmap below.

## Three ways to use it

1. **Drop-in** — mount `<WebphoneProvider>` + `<Dialer />` and get a working, draggable
   softphone widget (dial pad, in-call controls, incoming-call card, device/audio settings,
   post-call wrap-up, Picture-in-Picture) with zero UI work.
2. **Headless, with context** — `SipProvider` + `useSip()` / `useSipActions()` gives you SIP
   state and call-control actions anywhere in the tree (e.g. a click-to-call button in a
   CRM/ERP contact list), so you build your own UI on top.
3. **Headless, no context** — call the `useSIPClient` hook directly in a single component if
   you don't want React context at all, or need more than one independent SIP client in the
   same app.

None of the three fetches credentials for you — you provide SIP credentials and a WSS URL from
your own backend or SIP/PBX provider.

## Install

```bash
npm install @telvoip/webphone-react
```

```tsx
import { WebphoneProvider, Dialer } from "@telvoip/webphone-react";
import "@telvoip/webphone-react/style.css";

function App() {
  return (
    <WebphoneProvider
      credentials={{
        sipUsername: "1001",
        sipPassword: "...",
        sipDomain: "tenant.example.com",
        sipWsUrl: "wss://sip.example.com:7443",
      }}
    >
      <YourApp />
      <Dialer />
    </WebphoneProvider>
  );
}
```

No Tailwind, no MUI, no CSS framework required in your app. `style.css` is compiled at build
time (Tailwind is only a dev-time authoring tool for this package) and every rule is scoped
under `.twp-root` with `!important`, so it can't collide with or be overridden by your own
app's CSS — every exported component already carries that class, nothing to add yourself.

`WebphoneProvider` also adds a public STUN fallback (`stun:stun.l.google.com:19302`) to your ICE
servers if you didn't supply any, since ICE gathering behind NAT typically needs at least one to
succeed. It's the same convenience `<Dialer />`-based integrations get automatically; see
[Headless usage](#headless-usage-your-own-ui) if you're not using `WebphoneProvider` and want it
too.

## Headless usage (your own UI)

`SipProvider` gives you the same SIP engine `<Dialer />` is built on, without any of its UI.
Read call state with `useSip()`, trigger actions with `useSipActions()`:

```tsx
import { useState } from "react";
import { SipProvider, useSip, useSipActions } from "@telvoip/webphone-react";

function Softphone() {
  const { state } = useSip()!;
  const actions = useSipActions()!;
  const [target, setTarget] = useState("");

  if (state.callStatus === "incoming") {
    const caller = state.pendingCallRemote?.displayName ?? state.pendingCallRemote?.uri ?? "Unknown";
    return (
      <div>
        <p>Incoming call from {caller}</p>
        <button onClick={() => actions.answer()}>Answer</button>
        <button onClick={() => actions.reject()}>Reject</button>
      </div>
    );
  }

  return (
    <div>
      <p>{state.registered ? "Ready" : "Connecting…"}</p>
      <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Enter a number" />
      <button onClick={() => actions.startCall(target)} disabled={state.callStatus !== "idle"}>
        Call
      </button>
      {state.callStatus === "in-call" ? (
        <>
          <p>In call — {state.duration}s</p>
          <button onClick={() => actions.toggleMute()}>{state.muted ? "Unmute" : "Mute"}</button>
          <button onClick={() => actions.hangup()}>Hang up</button>
        </>
      ) : null}
    </div>
  );
}

export default function App() {
  return (
    <SipProvider
      credentials={{
        sipUsername: "1001",
        sipPassword: "...",
        sipDomain: "tenant.example.com",
        sipWsUrl: "wss://sip.example.com:7443",
      }}
    >
      <Softphone />
    </SipProvider>
  );
}
```

**Register an `<audio>` element yourself.** Unlike `WebphoneProvider`, `SipProvider` doesn't
render one for you — without it, calls connect but you'll hear nothing:

```tsx
import { useEffect, useRef } from "react";
import { useSipActions } from "@telvoip/webphone-react";

function CallAudio() {
  const actions = useSipActions();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    actions?.registerAudioElement(audioRef.current);
    return () => actions?.registerAudioElement(null);
  }, [actions]);

  return <audio ref={audioRef} hidden autoPlay playsInline />;
}
```

### Click-to-call from an existing UI (CRM/ERP)

`useSipActions()` is referentially stable and doesn't re-render on call ticks, so it's cheap to
call from many rows of a table without re-rendering the whole list every second during a call:

```tsx
import { useState } from "react";
import { useSipActions } from "@telvoip/webphone-react";

function CallButton({ phone }: { phone: string }) {
  const actions = useSipActions();
  const [calling, setCalling] = useState(false);

  const call = async () => {
    if (!actions || calling) return;
    setCalling(true);
    try {
      // The provider owns the dial plan (see "Dial-target normalization"
      // below), so this can pass the contact's raw display number through
      // untouched.
      await actions.startCall(phone);
    } finally {
      setCalling(false);
    }
  };

  return (
    <button onClick={() => void call()} disabled={!actions || calling}>
      {calling ? "Calling…" : "Call"}
    </button>
  );
}
```

Mount this anywhere under your `SipProvider`/`WebphoneProvider` — a contacts table, a deal page,
a support ticket. See `example/src/App.tsx`'s `ContactsWorkspace` for a fuller version with a
contact list + detail panel.

### Using the hook directly, without any context

For a single component that wants full control (or an app running more than one independent SIP
client), skip `SipProvider` entirely and call `useSIPClient` yourself. You're responsible for
normalizing credentials (`normalizeCredentials`, the same helper `SipProvider` uses internally)
and for registering an `<audio>` element:

```tsx
import { useSIPClient, normalizeCredentials } from "@telvoip/webphone-react";

function Softphone() {
  const config = normalizeCredentials({
    sipUsername: "1001",
    sipPassword: "...",
    sipDomain: "tenant.example.com",
    sipWsUrl: "wss://sip.example.com:7443",
  });

  const sip = useSIPClient(config ?? {}, {
    onRegistrationFailed: (cause) => console.warn("Registration failed:", cause),
    // Self-host RNNoise instead of loading it from jsdelivr - see
    // "Noise suppression" below. Only reachable at this layer today.
    noiseSuppressionAssetBaseUrl: "/vendor/webphone-noise",
  });

  return (
    <div>
      <p>{sip.isRegistered ? "Ready" : "Connecting…"}</p>
      <button onClick={() => sip.makeCall("+15551234567")}>Call</button>
      <button onClick={() => sip.endCall()}>Hang up</button>
    </div>
  );
}
```

`useSIPClient`'s return value has a larger surface than `useSip()`'s mapped `SipState`/
`SipActions` (e.g. `makeCall`/`endCall`/`answerCall` instead of `startCall`/`hangup`/`answer`) —
it's the lower-level primitive `SipProvider` wraps, not a drop-in replacement for it. Reach for
`SipProvider` + `useSip()`/`useSipActions()` first; use this only when you specifically need to
avoid React context.

### Theming

Override any of these CSS custom properties (on `.twp-root` or an ancestor of it) to reskin
without forking:

```css
.twp-root {
  --twp-color-primary: #7c3aed;
  --twp-color-danger: #e11d48;
  --twp-radius: 8px;
  /* ...--twp-color-secondary, --twp-color-surface, --twp-color-surface-muted,
     --twp-color-border, --twp-color-text-primary, --twp-color-text-secondary */
}
```

### Draggable pill, outbound caller ID, i18n

```tsx
<Dialer
  draggable            // default true - false pins it to `corner` instead
  corner="bottom-right"
  labels={{ hangup: "Raccrocher" }}   // override any subset of the default English strings
  outboundDids={[
    { id: "primary", number: "+15551234567", label: "Main line", selected: true },
    { id: "sales", number: "+15557654321", label: "Sales" },
  ]}
  onOutboundDidSelect={async (did) => {
    // Persist the selection through your own backend, then update the list
    // you pass back into `outboundDids` (optimistic update shown here).
  }}
/>
```

`outboundDids` is optional — omit it and the settings panel simply doesn't show caller-ID
selection. When supplied, `<Dialer />`'s settings panel lets the signed-in agent pick which
number is used as their outbound caller ID; persisting that choice is entirely up to your
`onOutboundDidSelect` handler (the package has no opinion on how/where it's stored).

### Dial-target normalization

Every phone number `startCall()` is given (typed by an agent, or passed from a CRM row) can be
run through [libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js) before
dialing, so callers don't each have to strip/format numbers themselves:

```tsx
<WebphoneProvider
  credentials={credentials}
  dialTargetFormat="national"   // "preserve" (default) | "national" | "e164"
  defaultCallingCountry="KE"    // ISO 3166-1 alpha-2, used when a number has no country code
>
  <Dialer />
</WebphoneProvider>
```

`startCall()`/`actions.startCall()` also accepts `{ number, country }` instead of a plain string
to specify a number's country inline, which takes precedence over `defaultCallingCountry`.
Numbers that can't be parsed (PBX extensions, already-dialable strings) are passed through
unchanged rather than rejected. Need custom dial-plan logic instead of the built-in formats?
Pass `formatDialTarget` (takes precedence over `dialTargetFormat`):

```tsx
import { createDialTargetFormatter } from "@telvoip/webphone-react";

<WebphoneProvider credentials={credentials} formatDialTarget={createDialTargetFormatter("e164", "KE")}>
```

### Noise suppression

Noise suppression (RNNoise) is on by default, loading its WASM/worklet assets from a
version-pinned jsdelivr URL. To self-host instead (offline/CSP-restricted deployments), copy
`dist/noise-assets/*` from this package somewhere in your own app and pass the override — today
that's only reachable via `useSIPClient` directly (see
[Using the hook directly](#using-the-hook-directly-without-any-context) above):

```tsx
useSIPClient(config, { noiseSuppressionAssetBaseUrl: "/vendor/webphone-noise" })
```

## Example app

```bash
bun install
bun run build          # the example imports the built dist/, not src/ directly
cp example/.env.example example/.env.local   # fill in real SIP credentials, or skip and use the on-page form
bun run example:dev    # relinks the package (see note below) before starting Vite
```

**After every `bun run build`, re-run `bun run example:dev`** (it re-links
automatically) rather than just refreshing the browser tab on an already-running
dev server. tsup does a clean rebuild (deletes and recreates `dist/*`), which
breaks the hardlink `bun install` set up for `example`'s `file:..` dependency on
this package - the running dev server keeps serving the orphaned pre-rebuild
content until the link is re-established. `bun run example:dev` runs `bun install`
first specifically to avoid this trap; restarting the dev server *without* also
re-running install will look like "my change had no effect" even though the build
genuinely succeeded.

The example includes both the drop-in `<Dialer />` widget and a `ContactsWorkspace` (a
CRM-style contact table + detail panel) demonstrating click-to-call via `useSipActions()`.

## Roadmap / status

- [x] Core engine (`useSIPClient`) + pure helpers ported
- [x] Context/provider layer (`SipProvider`, `useSip`, `useSipActions`)
- [x] Noise suppression (RNNoise, CDN-hosted assets)
- [x] UI: primitives (`DialPad`, `DevicePicker`, `TransferPad`, `AudioSettingsPanel`, ...)
- [x] UI: `<Dialer />` (draggable, PiP-capable, outbound caller-ID selection)
- [x] Dial-target normalization (E.164/national, via libphonenumber-js)
- [x] Example app (drop-in widget + CRM-style click-to-call workspace)
- [ ] First npm publish (needs the `@telvoip` npm org claimed + `NPM_TOKEN` secret - a manual,
      one-time step outside this repo)

Deliberately **not** in scope for v1: call-center queue status, billing/minutes UI, contact
directory search, notes, call-insights diagnostics drawer, multi-tab leader election (each tab
runs its own independent SIP registration - two tabs open means two registered endpoints, not
one shared call), call waiting (disabled to match production - a second incoming call is
declined automatically), attended/consultative transfer (blind transfer only), and a call-log/
history panel (build your own against `useSip()`'s state or your own backend if you need one -
this package doesn't retain call history).

## Development

This repo uses [bun](https://bun.sh).

```bash
bun install
bun run build      # tsup + compiled CSS + noise-suppression assets -> dist/
bun run test        # bun:test, unit tests
bun run test:webrtc # Playwright fake-media-device smoke test
bun run typecheck
bun run lint
```

## License

MIT. Bundles RNNoise WebAssembly assets under MIT/Apache-2.0 — see `LICENSE` for details.
