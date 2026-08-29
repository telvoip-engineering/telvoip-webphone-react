import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

type PendingWasmLoad = {
  resolve: (value: ArrayBuffer) => void;
  reject: (reason: Error) => void;
};

const pendingWasmLoads: PendingWasmLoad[] = [];
const createdFilters: FakeRnnoiseWorkletNode[] = [];
const destroyedFilters: FakeRnnoiseWorkletNode[] = [];

class FakeTrack extends EventTarget {
  kind = "audio";
  readyState: MediaStreamTrackState = "live";
  stopCalls = 0;

  stop() {
    this.stopCalls += 1;
    this.readyState = "ended";
    // MediaStreamTrack.stop() does not dispatch "ended"; explicit stream
    // disposal must still release the raw microphone chain.
  }

  getSettings() {
    return {};
  }
}

class FakeStream {
  constructor(private tracks: FakeTrack[]) {}

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  getTracks() {
    return [...this.tracks];
  }

  removeTrack(track: FakeTrack) {
    this.tracks = this.tracks.filter((candidate) => candidate !== track);
  }

  addTrack(track: FakeTrack) {
    this.tracks.push(track);
  }
}

class FakeRnnoiseWorkletNode {
  constructor() {
    createdFilters.push(this);
  }
  connect() {}
  disconnect() {}
  destroy() {
    destroyedFilters.push(this);
  }
}

mock.module("@sapphi-red/web-noise-suppressor", () => ({
  loadRnnoise: () =>
    new Promise<ArrayBuffer>((resolve, reject) => {
      pendingWasmLoads.push({ resolve, reject });
    }),
  RnnoiseWorkletNode: FakeRnnoiseWorkletNode,
}));

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalWorkletNodeDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "AudioWorkletNode"
);

class FakeAudioContext {
  state: AudioContextState = "running";
  audioWorklet = {
    addModule: async () => {},
  };

  constructor() {
    fakeContexts.push(this);
  }

  async resume() {
    this.state = "running";
  }

  async close() {
    this.state = "closed";
  }

  createMediaStreamSource() {
    return {
      connect() {},
      disconnect() {},
    };
  }

  createMediaStreamDestination() {
    return {
      stream: new FakeStream([new FakeTrack()]),
      connect() {},
      disconnect() {},
    };
  }
}

const fakeContexts: FakeAudioContext[] = [];

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    AudioContext: FakeAudioContext,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  },
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { mediaDevices: { getUserMedia: () => Promise.reject(new Error("unused")) } },
});
Object.defineProperty(globalThis, "AudioWorkletNode", {
  configurable: true,
  value: class {},
});

const {
  applyNoiseSuppressionToStream,
  disposeNoiseSuppression,
  disposeNoiseSuppressionForStream,
  preloadNoiseSuppression,
} = await import("./noiseSuppression");

const waitForWasmLoads = async (count: number) => {
  for (let attempt = 0; attempt < 50 && pendingWasmLoads.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(pendingWasmLoads).toHaveLength(count);
};

const restoreGlobal = (key: string, descriptor: PropertyDescriptor | undefined) => {
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, key);
  }
};

describe("noise suppression preload lifecycle", () => {
  beforeEach(() => {
    disposeNoiseSuppression();
    pendingWasmLoads.length = 0;
    fakeContexts.length = 0;
    createdFilters.length = 0;
    destroyedFilters.length = 0;
  });

  test("a stale preload failure cannot clear a newer successful preload", async () => {
    const stalePreload = preloadNoiseSuppression();
    await waitForWasmLoads(1);

    disposeNoiseSuppression();
    const currentPreload = preloadNoiseSuppression();
    await waitForWasmLoads(2);

    pendingWasmLoads[1].resolve(new ArrayBuffer(2));
    expect(await currentPreload).toEqual({ ok: true });

    pendingWasmLoads[0].reject(new Error("stale load failed"));
    expect(await stalePreload).toEqual({ ok: false, reason: "stale load failed" });

    expect(preloadNoiseSuppression()).toBe(currentPreload);
  });

  test("dispose cancels an activation that was already waiting for the lifecycle lock", async () => {
    const liveTrack = { readyState: "live" } as MediaStreamTrack;
    const stream = { getAudioTracks: () => [liveTrack] } as unknown as MediaStream;

    const activeRequest = applyNoiseSuppressionToStream(stream);
    await waitForWasmLoads(1);
    const queuedRequest = applyNoiseSuppressionToStream(stream);

    disposeNoiseSuppression();
    pendingWasmLoads[0].resolve(new ArrayBuffer(2));

    expect(await activeRequest).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pendingWasmLoads).toHaveLength(1);
    expect(await queuedRequest).toBe(false);
  });

  test("keeps the transmitted chain alive until its own stream is disposed", async () => {
    const firstRawTrack = new FakeTrack();
    const firstStream = new FakeStream([firstRawTrack]) as unknown as MediaStream;
    const firstActivation = applyNoiseSuppressionToStream(firstStream);
    await waitForWasmLoads(1);
    pendingWasmLoads[0].resolve(new ArrayBuffer(2));
    expect(await firstActivation).toBe(true);

    const secondRawTrack = new FakeTrack();
    const secondStream = new FakeStream([secondRawTrack]) as unknown as MediaStream;
    expect(await applyNoiseSuppressionToStream(secondStream)).toBe(true);

    // Preparing the replacement must not tear down the stream still attached
    // to RTCRtpSender.
    expect(firstRawTrack.stopCalls).toBe(0);
    expect(secondRawTrack.stopCalls).toBe(0);

    disposeNoiseSuppressionForStream(secondStream);
    expect(secondRawTrack.stopCalls).toBe(1);
    expect(firstRawTrack.stopCalls).toBe(0);

    disposeNoiseSuppressionForStream(firstStream);
    expect(firstRawTrack.stopCalls).toBe(1);
    expect(destroyedFilters).toHaveLength(2);
  });

  test("coalesces concurrent activation requests for the same stream", async () => {
    const rawTrack = new FakeTrack();
    const stream = new FakeStream([rawTrack]) as unknown as MediaStream;

    const firstActivation = applyNoiseSuppressionToStream(stream);
    const secondActivation = applyNoiseSuppressionToStream(stream);
    await waitForWasmLoads(1);
    pendingWasmLoads[0].resolve(new ArrayBuffer(2));

    expect(await Promise.all([firstActivation, secondActivation])).toEqual([true, true]);
    expect(createdFilters).toHaveLength(1);
    expect(rawTrack.stopCalls).toBe(0);

    disposeNoiseSuppressionForStream(stream);
    expect(rawTrack.stopCalls).toBe(1);
    expect(destroyedFilters).toHaveLength(1);
  });
});

afterAll(() => {
  disposeNoiseSuppression();
  restoreGlobal("window", originalWindowDescriptor);
  restoreGlobal("navigator", originalNavigatorDescriptor);
  restoreGlobal("AudioWorkletNode", originalWorkletNodeDescriptor);
});
