# @telvoip/webphone-react

A portable React hook and drop-in `<Dialer />` component for WebRTC/SIP softphones, built on
[JsSIP](https://jssip.net). Extracted from Telvoip's own client dashboard, so it's the same
engine handling real production calls — packaged for any React project to use.

> **Status: early development.** The engine and UI are being ported/rewritten in phases. See
> the roadmap below for what's ready.

## Two ways to use it

1. **Headless** — `useSIPClient` / `SipProvider` + `useSip()` drives the telephony in the
   background; build your own UI on top.
2. **Batteries-included** — drop in `<WebphoneProvider>` + `<Dialer />` and get a working,
   draggable softphone widget with zero UI work.

Neither path fetches credentials for you — you provide SIP credentials and a WSS URL (e.g. from
your own backend, or from Telvoip's `GET /api/developers/voice/credentials` endpoint if you're a
Telvoip Developer-kind account).

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
        sipWsUrl: "wss://app.telvoip.io:7443",
      }}
    >
      <YourApp />
      <Dialer />
    </WebphoneProvider>
  );
}
```

No Tailwind, no MUI, no CSS framework required in your app — `style.css` is a self-contained,
prefixed stylesheet.

## Roadmap / status

- [ ] Core engine (`useSIPClient`) + pure helpers ported
- [ ] Context/provider layer (`SipProvider`, `useSip`, `useSipActions`)
- [ ] Noise suppression (RNNoise, CDN-hosted assets)
- [ ] UI: primitives (`DialPad`, `DevicePicker`, `TransferPad`, `WrapUpCard`, ...)
- [ ] UI: `<Dialer />` (draggable, PiP-capable)
- [ ] Example app + first npm publish

Deliberately **not** in scope for v1: call-center queue status, billing/minutes UI, contact
directory search, notes, call-insights diagnostics drawer, multi-tab leader election, call
waiting (disabled to match production), attended/consultative transfer (blind transfer only).

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
