"use client";

// Loaded dynamically (browser-only): the package's module scope extends
// AudioWorkletNode, which does not exist during SSR. Static import would crash
// the server render of any page that pulls in the webphone context.
import type { RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";

const ASSET_FILENAMES = {
  worklet: "rnnoiseWorklet.js",
  wasm: "rnnoise.wasm",
  wasmSimd: "rnnoise_simd.wasm",
} as const;
const MAX_CHANNELS = 2;
const LOAD_TIMEOUT_MS = 4_000;

/**
 * Resolves where the RNNoise WASM/worklet assets load from. Defaults to a
 * jsdelivr URL pinned to *this exact installed version* (jsdelivr mirrors
 * any published npm package's tarball contents automatically - nothing to
 * host or configure) so a consumer never has to think about it. Pass
 * `overrideBaseUrl` (e.g. a same-origin path) to self-host instead, for
 * offline/air-gapped deployments or CSP policies that block third-party
 * script/wasm origins - copy dist/noise-assets/* from this package to that
 * path (the two LICENSE files are attribution-only, not fetched at runtime,
 * but should still be included in any self-hosted copy for compliance).
 */
export const resolveNoiseSuppressionAssetBaseUrl = (overrideBaseUrl?: string): string => {
  if (overrideBaseUrl && overrideBaseUrl.trim()) {
    return overrideBaseUrl.trim().replace(/\/+$/, "");
  }
  return `https://cdn.jsdelivr.net/npm/${__PACKAGE_NAME__}@${__PACKAGE_VERSION__}/dist/noise-assets`;
};

const resolveAssetUrls = (overrideBaseUrl?: string) => {
  const base = resolveNoiseSuppressionAssetBaseUrl(overrideBaseUrl);
  return {
    workletUrl: `${base}/${ASSET_FILENAMES.worklet}`,
    wasmUrl: `${base}/${ASSET_FILENAMES.wasm}`,
    wasmSimdUrl: `${base}/${ASSET_FILENAMES.wasmSimd}`,
  };
};

type NoiseSuppressorModule = typeof import("@sapphi-red/web-noise-suppressor");

let suppressorModulePromise: Promise<NoiseSuppressorModule> | null = null;
const loadSuppressorModule = (): Promise<NoiseSuppressorModule> => {
  if (!suppressorModulePromise) {
    suppressorModulePromise = import("@sapphi-red/web-noise-suppressor");
  }
  return suppressorModulePromise;
};

export type NoiseSuppressionLoadResult = { ok: true } | { ok: false; reason: string };

type ActiveChain = {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  filter: RnnoiseWorkletNode;
  destination: MediaStreamAudioDestinationNode;
  rawTrack: MediaStreamTrack | null;
  processedTrack: MediaStreamTrack | null;
  disposed: boolean;
};

let processingContext: AudioContext | null = null;
let wasmBinary: ArrayBuffer | null = null;
let loadPromise: Promise<NoiseSuppressionLoadResult> | null = null;
let loadOwner: symbol | null = null;
const activeChains = new Map<MediaStream, ActiveChain>();
let activationLock: Promise<void> = Promise.resolve();
let lifecycleGeneration = 0;

const getContext = (): AudioContext | null => {
  if (processingContext?.state === "closed") {
    processingContext = null;
    loadPromise = null;
    loadOwner = null;
  }
  if (processingContext) return processingContext;
  if (typeof window === "undefined") return null;
  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  try {
    processingContext = new AudioContextCtor({ sampleRate: 48_000 });
  } catch {
    try {
      processingContext = new AudioContextCtor();
    } catch {
      return null;
    }
  }
  return processingContext;
};

export const isNoiseSuppressionSupported = (): boolean =>
  typeof window !== "undefined" &&
  typeof AudioWorkletNode !== "undefined" &&
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * @param assetBaseUrl Override for where the WASM/worklet assets load from
 *   (see resolveNoiseSuppressionAssetBaseUrl). Only consulted on the first
 *   call per page load - like the rest of this module, loading is a
 *   singleton (one shared AudioContext/worklet), so the base URL is fixed
 *   once loading starts and isn't reconfigurable mid-session.
 */
export const preloadNoiseSuppression = (
  assetBaseUrl?: string
): Promise<NoiseSuppressionLoadResult> => {
  if (!isNoiseSuppressionSupported()) {
    return Promise.resolve({ ok: false, reason: "AudioWorklet not supported" });
  }
  if (loadPromise) return loadPromise;

  const { workletUrl, wasmUrl, wasmSimdUrl } = resolveAssetUrls(assetBaseUrl);

  const context = getContext();
  if (!context) {
    return Promise.resolve({ ok: false, reason: "AudioContext unavailable" });
  }

  const owner = Symbol("noise-suppression-load");
  const generation = lifecycleGeneration;
  loadOwner = owner;

  loadPromise = new Promise<NoiseSuppressionLoadResult>((resolve) => {
    let settled = false;
    const ownsLoad = () =>
      loadOwner === owner && lifecycleGeneration === generation && processingContext === context;
    const finish = (result: NoiseSuppressionLoadResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(result);
    };
    const timeout = window.setTimeout(() => {
      if (ownsLoad()) {
        wasmBinary = null;
        loadPromise = null;
        loadOwner = null;
      }
      finish({ ok: false, reason: "Noise suppression load timed out" });
    }, LOAD_TIMEOUT_MS);

    (async () => {
      try {
        await context.audioWorklet.addModule(workletUrl);
        if (!ownsLoad()) {
          finish({ ok: false, reason: "Noise suppression load superseded" });
          return;
        }
        const { loadRnnoise } = await loadSuppressorModule();
        if (!ownsLoad()) {
          finish({ ok: false, reason: "Noise suppression load superseded" });
          return;
        }
        const loadedWasmBinary = await loadRnnoise({ url: wasmUrl, simdUrl: wasmSimdUrl });
        if (!ownsLoad()) {
          finish({ ok: false, reason: "Noise suppression load superseded" });
          return;
        }
        if (context.state === "suspended") {
          await context.resume().catch(() => {});
        }
        if (!ownsLoad() || context.state === "closed") {
          finish({ ok: false, reason: "Noise suppression load superseded" });
          return;
        }
        wasmBinary = loadedWasmBinary;
        finish({ ok: true });
      } catch (error) {
        if (ownsLoad()) {
          wasmBinary = null;
          loadPromise = null;
          loadOwner = null;
        }
        console.warn(
          "[webphone-react] Noise suppression failed to load from",
          `${workletUrl.replace(/\/[^/]+$/, "")}.`,
          "Calls continue without it. If this is a CSP or offline environment, self-host the",
          "assets from dist/noise-assets/ and pass noiseSuppression.assetBaseUrl.",
          error
        );
        finish({
          ok: false,
          reason: error instanceof Error ? error.message : "Noise suppression failed to load",
        });
      }
    })();
  });

  return loadPromise;
};

const stopRawTrack = (chain: ActiveChain) => {
  if (chain.rawTrack) {
    try {
      chain.rawTrack.stop();
    } catch {
      /* noop */
    }
    chain.rawTrack = null;
  }
};

const teardownChain = (chain: ActiveChain | null) => {
  if (!chain || chain.disposed) return;
  chain.disposed = true;
  if (activeChains.get(chain.stream) === chain) {
    activeChains.delete(chain.stream);
  }
  try {
    chain.source.disconnect();
  } catch {
    /* noop */
  }
  try {
    chain.filter.disconnect();
  } catch {
    /* noop */
  }
  try {
    chain.filter.destroy();
  } catch {
    /* noop */
  }
  try {
    chain.destination.disconnect();
  } catch {
    /* noop */
  }
  stopRawTrack(chain);
  if (chain.processedTrack) {
    try {
      chain.processedTrack.stop();
    } catch {
      /* noop */
    }
    chain.processedTrack = null;
  }
};

export const disposeNoiseSuppressionForStream = (stream: MediaStream | null | undefined) => {
  if (!stream) return;
  teardownChain(activeChains.get(stream) ?? null);
};

const closeProcessingContext = () => {
  const context = processingContext;
  processingContext = null;
  wasmBinary = null;
  loadPromise = null;
  loadOwner = null;

  if (context && context.state !== "closed") {
    void context.close().catch(() => {});
  }
};

export const disposeNoiseSuppression = () => {
  lifecycleGeneration += 1;
  Array.from(activeChains.values()).forEach(teardownChain);
  activeChains.clear();
  closeProcessingContext();
};

/**
 * Wires the given stream's first audio track through the RNNoise worklet and
 * replaces the track in-place so downstream consumers (mute, self-test,
 * replaceTrack) keep working unchanged. The original mic track is stopped when
 * the processed track ends (or on dispose). Returns false when the filter
 * could not be activated — the caller then falls back to the raw stream.
 */
export const applyNoiseSuppressionToStream = async (stream: MediaStream): Promise<boolean> => {
  if (activeChains.has(stream)) return true;
  const activationGeneration = lifecycleGeneration;
  const previousActivation = activationLock;
  let releaseActivation = () => {};
  activationLock = new Promise<void>((resolve) => {
    releaseActivation = resolve;
  });
  await previousActivation;
  let candidateChain: ActiveChain | null = null;
  try {
    if (activationGeneration !== lifecycleGeneration) return false;
    // Another queued activation for this same stream may have completed while
    // this request waited for the lifecycle lock.
    if (activeChains.has(stream)) return true;
    const rawTrack = stream.getAudioTracks()[0];
    if (!rawTrack || rawTrack.readyState !== "live") return false;

    const context = getContext();
    if (!context) return false;

    const loaded = await preloadNoiseSuppression();
    if (!loaded.ok || !wasmBinary || activationGeneration !== lifecycleGeneration) return false;

    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        return false;
      }
      if (context.state === "suspended") return false;
    }

    const { RnnoiseWorkletNode: RnnoiseWorkletNodeClass } = await loadSuppressorModule();
    if (activationGeneration !== lifecycleGeneration || context.state === "closed") return false;
    const source = context.createMediaStreamSource(stream);
    const filter = new RnnoiseWorkletNodeClass(context, {
      maxChannels: MAX_CHANNELS,
      wasmBinary,
    });
    const destination = context.createMediaStreamDestination();
    source.connect(filter);
    filter.connect(destination);

    const processedTrack = destination.stream.getAudioTracks()[0];
    const chain: ActiveChain = {
      stream,
      source,
      filter,
      destination,
      rawTrack,
      processedTrack,
      disposed: false,
    };
    candidateChain = chain;
    if (activationGeneration !== lifecycleGeneration) {
      teardownChain(chain);
      return false;
    }
    activeChains.set(stream, chain);

    const onProcessedTrackEnded = () => {
      teardownChain(chain);
    };
    processedTrack.addEventListener("ended", onProcessedTrackEnded, { once: true });

    stream.removeTrack(rawTrack);
    stream.addTrack(processedTrack);

    return true;
  } catch (error) {
    console.warn("[SIP] Failed to apply noise suppression", error);
    teardownChain(candidateChain);
    return false;
  } finally {
    releaseActivation();
  }
};
