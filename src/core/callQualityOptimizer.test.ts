import { describe, expect, test } from "bun:test";
import { createCallQualityOptimizer } from "./callQualityOptimizer";

describe("createCallQualityOptimizer", () => {
  test("does not infer interval quality from the first cumulative sample", () => {
    const optimizer = createCallQualityOptimizer();
    const result = optimizer.sample({
      atMs: 1_000,
      packetsLost: 20,
      packetsReceived: 980,
      totalSamplesReceived: 48_000,
      concealedSamples: 500,
    });

    expect(result.intervalPacketLossPct).toBeNull();
    expect(result.intervalDownlinkPacketLossPct).toBeNull();
    expect(result.intervalUplinkPacketLossPct).toBeNull();
    expect(result.concealmentPct).toBeNull();
  });

  test("calculates packet loss and concealment from counter deltas", () => {
    const optimizer = createCallQualityOptimizer();
    optimizer.sample({
      atMs: 1_000,
      packetsLost: 10,
      packetsReceived: 990,
      totalSamplesReceived: 48_000,
      concealedSamples: 100,
      concealmentEvents: 2,
    });
    const result = optimizer.sample({
      atMs: 6_000,
      packetsLost: 20,
      packetsReceived: 1_190,
      totalSamplesReceived: 72_000,
      concealedSamples: 580,
      concealmentEvents: 5,
    });

    expect(result.sampleWindowMs).toBe(5_000);
    expect(result.intervalPacketLossPct).toBe((10 / 210) * 100);
    expect(result.intervalDownlinkPacketLossPct).toBe((10 / 210) * 100);
    expect(result.intervalUplinkPacketLossPct).toBeNull();
    expect(result.concealmentPct).toBe((480 / 24_000) * 100);
    expect(result.concealmentEvents).toBe(3);
  });

  test("estimates the actual average jitter-buffer delay", () => {
    const optimizer = createCallQualityOptimizer();
    optimizer.sample({ atMs: 1_000, jitterBufferDelaySeconds: 2, jitterBufferEmittedCount: 100 });
    const result = optimizer.sample({
      atMs: 6_000,
      jitterBufferDelaySeconds: 2.8,
      jitterBufferEmittedCount: 140,
    });

    expect(Math.round((result.jitterBufferDelayMs ?? 0) * 100) / 100).toBe(20);
  });

  test("resets a counter baseline after a browser stat reset", () => {
    const optimizer = createCallQualityOptimizer();
    optimizer.sample({ atMs: 1_000, packetsLost: 10, packetsReceived: 100 });
    const result = optimizer.sample({ atMs: 6_000, packetsLost: 1, packetsReceived: 10 });

    expect(result.intervalPacketLossPct).toBeNull();
    const next = optimizer.sample({ atMs: 11_000, packetsLost: 2, packetsReceived: 110 });
    expect(next.intervalPacketLossPct).toBe((1 / 101) * 100);
  });

  test("scores uplink loss reported by remote-inbound-rtp", () => {
    const optimizer = createCallQualityOptimizer();
    optimizer.sample({
      atMs: 1_000,
      packetsLost: 0,
      packetsReceived: 100,
      remotePacketsLost: 2,
      remotePacketsReceived: 98,
    });
    const result = optimizer.sample({
      atMs: 6_000,
      packetsLost: 1,
      packetsReceived: 299,
      remotePacketsLost: 12,
      remotePacketsReceived: 288,
    });

    expect(result.intervalDownlinkPacketLossPct).toBe((1 / 200) * 100);
    expect(result.intervalUplinkPacketLossPct).toBe((10 / 200) * 100);
    expect(result.intervalPacketLossPct).toBe((10 / 200) * 100);
  });

  test("uses locally sent packets when remote received counters are unavailable", () => {
    const optimizer = createCallQualityOptimizer();
    optimizer.sample({ atMs: 1_000, remotePacketsLost: 2, packetsSent: 100 });
    const result = optimizer.sample({ atMs: 6_000, remotePacketsLost: 7, packetsSent: 300 });

    expect(result.intervalUplinkPacketLossPct).toBe((5 / 200) * 100);
    expect(result.intervalPacketLossPct).toBe((5 / 200) * 100);
  });
});
