# @telvoip/webphone-react

A portable React hook and drop-in `<Dialer />` component for WebRTC/SIP softphones, built on
[JsSIP](https://jssip.net). Extracted from Telvoip's own client dashboard, so it's the same
engine handling real production calls — packaged for any React project to use.

> **Status: pre-release.** The engine and UI are built and wired together; not yet published to
> npm. See the roadmap below.

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

No Tailwind, no MUI, no CSS framework required in your app. `style.css` is compiled at build
time (Tailwind is only a dev-time authoring tool for this package) and every rule is scoped
under `.twp-root` with `!important`, so it can't collide with or be overridden by your own
app's CSS — every exported component already carries that class, nothing to add yourself.

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

### Draggable pill, noise suppression, i18n

```tsx
<Dialer
  draggable            // default true - false pins it to `corner` instead
  corner="bottom-right"
  labels={{ hangup: "Raccrocher" }}   // override any subset of the default English strings
/>
```

Noise suppression (RNNoise) is on by default, loading its WASM/worklet assets from a
version-pinned jsdelivr URL. To self-host instead (offline/CSP-restricted deployments), copy
`dist/noise-assets/*` from this package somewhere in your own app and pass:

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

## Roadmap / status

- [x] Core engine (`useSIPClient`) + pure helpers ported
- [x] Context/provider layer (`SipProvider`, `useSip`, `useSipActions`)
- [x] Noise suppression (RNNoise, CDN-hosted assets)
- [x] UI: primitives (`DialPad`, `DevicePicker`, `TransferPad`, `WrapUpCard`, ...)
- [x] UI: `<Dialer />` (draggable, PiP-capable)
- [x] Example app
- [ ] First npm publish (needs the `@telvoip` npm org claimed + `NPM_TOKEN` secret - a manual,
      one-time step outside this repo)

Deliberately **not** in scope for v1: call-center queue status, billing/minutes UI, contact
directory search, notes, call-insights diagnostics drawer, multi-tab leader election (each tab
runs its own independent SIP registration - two tabs open means two registered endpoints, not
one shared call), call waiting (disabled to match production - a second incoming call is
declined automatically), attended/consultative transfer (blind transfer only), and live
microphone-level metering in `<Dialer />`'s device settings panel (stubbed at 0 - a real meter
would need a second `getUserMedia` capture running alongside the SIP client's own, a device-
conflict risk not worth taking for a cosmetic indicator; build your own against `useSIPClient`
if you need one).

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
