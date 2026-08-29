/**
 * Turns cumulative WebRTC audio counters into interval metrics.
 *
 * Browser WebRTC implementations own the adaptive jitter buffer and packet
 * loss concealment. This small stateful helper observes their counters at a
 * fixed cadence so the UI can react to a bad five-second window instead of
 * waiting for lifetime call totals to dilute or exaggerate the result.
 */

export interface AudioQualityStatsSample {
  atMs?: number;
  jitterSeconds?: number | null;
  packetsLost?: number | null;
  packetsReceived?: number | null;
  remotePacketsLost?: number | null;
  remotePacketsReceived?: number | null;
  packetsSent?: number | null;
  jitterBufferDelaySeconds?: number | null;
  jitterBufferEmittedCount?: number | null;
  totalSamplesReceived?: number | null;
  concealedSamples?: number | null;
  concealmentEvents?: number | null;
  roundTripTimeSeconds?: number | null;
}

export interface AdaptiveAudioQualityMetrics {
  sampleWindowMs: number | null;
  /** Worst observed direction, retained for existing UI consumers. */
  intervalPacketLossPct: number | null;
  intervalDownlinkPacketLossPct: number | null;
  intervalUplinkPacketLossPct: number | null;
  concealmentPct: number | null;
  concealmentEvents: number | null;
  jitterBufferDelayMs: number | null;
  smoothedJitterMs: number | null;
  smoothedRttMs: number | null;
}

const EWMA_ALPHA = 0.35;
const finite = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const delta = (
  current: number | null | undefined,
  previous: number | null | undefined
): number | null => {
  if (current == null || previous == null || current < previous) return null;
  return current - previous;
};

const smooth = (previous: number | null, next: number | null | undefined): number | null => {
  if (next == null) return previous;
  return previous === null ? next : previous + EWMA_ALPHA * (next - previous);
};

export interface CallQualityOptimizer {
  sample: (sample: AudioQualityStatsSample) => AdaptiveAudioQualityMetrics;
  reset: () => void;
}

export const createCallQualityOptimizer = (): CallQualityOptimizer => {
  let previous: (AudioQualityStatsSample & { atMs: number }) | null = null;
  let smoothedJitterMs: number | null = null;
  let smoothedRttMs: number | null = null;

  const reset = () => {
    previous = null;
    smoothedJitterMs = null;
    smoothedRttMs = null;
  };

  const sample = (input: AudioQualityStatsSample): AdaptiveAudioQualityMetrics => {
    const current = {
      ...input,
      atMs: finite(input.atMs) ?? Date.now(),
      jitterSeconds: finite(input.jitterSeconds),
      packetsLost: finite(input.packetsLost),
      packetsReceived: finite(input.packetsReceived),
      remotePacketsLost: finite(input.remotePacketsLost),
      remotePacketsReceived: finite(input.remotePacketsReceived),
      packetsSent: finite(input.packetsSent),
      jitterBufferDelaySeconds: finite(input.jitterBufferDelaySeconds),
      jitterBufferEmittedCount: finite(input.jitterBufferEmittedCount),
      totalSamplesReceived: finite(input.totalSamplesReceived),
      concealedSamples: finite(input.concealedSamples),
      concealmentEvents: finite(input.concealmentEvents),
      roundTripTimeSeconds: finite(input.roundTripTimeSeconds),
    };

    const jitterMs = current.jitterSeconds === null ? null : current.jitterSeconds * 1000;
    const rttMs =
      current.roundTripTimeSeconds === null ? null : current.roundTripTimeSeconds * 1000;
    smoothedJitterMs = smooth(smoothedJitterMs, jitterMs);
    smoothedRttMs = smooth(smoothedRttMs, rttMs);

    const result: AdaptiveAudioQualityMetrics = {
      sampleWindowMs: null,
      intervalPacketLossPct: null,
      intervalDownlinkPacketLossPct: null,
      intervalUplinkPacketLossPct: null,
      concealmentPct: null,
      concealmentEvents: null,
      jitterBufferDelayMs: null,
      smoothedJitterMs,
      smoothedRttMs,
    };

    if (previous) {
      const windowMs = current.atMs - previous.atMs;
      result.sampleWindowMs = windowMs > 0 ? windowMs : null;

      const lost = delta(current.packetsLost, previous.packetsLost);
      const received = delta(current.packetsReceived, previous.packetsReceived);
      if (lost !== null && received !== null && lost + received > 0) {
        result.intervalDownlinkPacketLossPct = (lost / (lost + received)) * 100;
      }

      const remoteLost = delta(current.remotePacketsLost, previous.remotePacketsLost);
      const remoteReceived = delta(current.remotePacketsReceived, previous.remotePacketsReceived);
      const sent = delta(current.packetsSent, previous.packetsSent);
      if (remoteLost !== null) {
        if (remoteReceived !== null && remoteLost + remoteReceived > 0) {
          result.intervalUplinkPacketLossPct = (remoteLost / (remoteLost + remoteReceived)) * 100;
        } else if (sent !== null && sent > 0) {
          result.intervalUplinkPacketLossPct = Math.min(100, (remoteLost / sent) * 100);
        }
      }

      const directionalLoss = [
        result.intervalDownlinkPacketLossPct,
        result.intervalUplinkPacketLossPct,
      ].filter((value): value is number => value !== null);
      result.intervalPacketLossPct = directionalLoss.length ? Math.max(...directionalLoss) : null;

      const samples = delta(current.totalSamplesReceived, previous.totalSamplesReceived);
      const concealed = delta(current.concealedSamples, previous.concealedSamples);
      if (samples !== null && concealed !== null && samples > 0) {
        result.concealmentPct = (concealed / samples) * 100;
      }

      const events = delta(current.concealmentEvents, previous.concealmentEvents);
      result.concealmentEvents = events;

      const bufferDelay = delta(
        current.jitterBufferDelaySeconds,
        previous.jitterBufferDelaySeconds
      );
      const emitted = delta(current.jitterBufferEmittedCount, previous.jitterBufferEmittedCount);
      if (bufferDelay !== null && emitted !== null && emitted > 0) {
        result.jitterBufferDelayMs = (bufferDelay / emitted) * 1000;
      }
    }

    previous = current;
    return result;
  };

  return { sample, reset };
};
