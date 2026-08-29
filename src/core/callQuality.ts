export type CallQuality = "good" | "fair" | "poor" | "unknown";

export type CallQualityIssueId = "ice" | "jitter" | "packetLoss" | "concealment" | "rtt";

export interface CallQualityIssue {
  id: CallQualityIssueId;
  severity: Exclude<CallQuality, "good" | "unknown">;
  value: string;
}

export interface CallQualityAssessment {
  quality: CallQuality;
  detail: string;
  metrics: {
    jitterMs: number | null;
    /** Worst observed direction, retained for existing UI consumers. */
    packetLossPct: number | null;
    downlinkPacketLossPct: number | null;
    uplinkPacketLossPct: number | null;
    concealmentPct: number | null;
    jitterBufferDelayMs: number | null;
    rttMs: number | null;
    iceState: string | null;
  };
  issues: CallQualityIssue[];
}

type LiveDiagnostics = {
  metrics?: {
    iceConnectionState?: string | null;
    inboundAudio?: Record<string, unknown>;
    outboundAudio?: Record<string, unknown>;
    remoteInbound?: Record<string, unknown>;
    candidatePair?: Record<string, unknown>;
    adaptive?: Record<string, unknown>;
    statsError?: string;
  };
};

const readMetricNumber = (
  record: Record<string, unknown> | undefined,
  key: string
): number | null => {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const formatMetric = (label: string, value: number, unit: string, precision = 0): string => {
  const formatted = precision > 0 ? value.toFixed(precision) : String(Math.round(value));
  return `${label} ${formatted}${unit}`;
};

const issueSeverity = (
  value: number | null,
  fairThreshold: number,
  poorThreshold: number
): Exclude<CallQuality, "good" | "unknown"> | null => {
  if (value === null) return null;
  if (value > poorThreshold) return "poor";
  if (value > fairThreshold) return "fair";
  return null;
};

const percentage = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? Math.min(100, Math.max(0, (numerator / denominator) * 100)) : null;

const calculateReceivedPacketLoss = (
  report: Record<string, unknown> | undefined
): number | null => {
  const packetsLost = readMetricNumber(report, "packetsLost");
  const packetsReceived = readMetricNumber(report, "packetsReceived");
  if (packetsLost === null || packetsReceived === null) return null;
  return percentage(packetsLost, packetsLost + packetsReceived);
};

const calculateUplinkPacketLoss = (
  remoteInbound: Record<string, unknown> | undefined,
  outbound: Record<string, unknown> | undefined
): number | null => {
  const receivedLoss = calculateReceivedPacketLoss(remoteInbound);
  if (receivedLoss !== null) return receivedLoss;

  const fractionLost = readMetricNumber(remoteInbound, "fractionLost");
  if (fractionLost !== null) {
    // RTCRemoteInboundRtpStreamStats exposes the RTCP 8-bit fixed-point value.
    return Math.min(100, Math.max(0, (fractionLost / 256) * 100));
  }

  const packetsLost = readMetricNumber(remoteInbound, "packetsLost");
  const packetsSent = readMetricNumber(outbound, "packetsSent");
  if (packetsLost === null || packetsSent === null) return null;
  return percentage(packetsLost, packetsSent);
};

const maximumAvailable = (...values: Array<number | null>): number | null => {
  const available = values.filter((value): value is number => value !== null);
  return available.length ? Math.max(...available) : null;
};

export const calculateCallQuality = (diagnostics?: unknown): CallQualityAssessment => {
  const live = diagnostics as LiveDiagnostics | null | undefined;
  const metrics = live?.metrics;

  const empty: CallQualityAssessment = {
    quality: "unknown",
    detail: "",
    metrics: {
      jitterMs: null,
      packetLossPct: null,
      downlinkPacketLossPct: null,
      uplinkPacketLossPct: null,
      concealmentPct: null,
      jitterBufferDelayMs: null,
      rttMs: null,
      iceState: null,
    },
    issues: [],
  };

  if (!metrics) {
    return empty;
  }

  const inbound = metrics.inboundAudio;
  const outbound = metrics.outboundAudio;
  const remoteInbound = metrics.remoteInbound;
  const candidatePair = metrics.candidatePair;
  const adaptive = metrics.adaptive;
  const jitterSeconds =
    readMetricNumber(inbound, "jitter") ?? readMetricNumber(remoteInbound, "jitter");
  const jitterMs =
    readMetricNumber(adaptive, "smoothedJitterMs") ??
    (jitterSeconds === null ? null : jitterSeconds * 1000);
  const downlinkPacketLossPct =
    readMetricNumber(adaptive, "intervalDownlinkPacketLossPct") ??
    calculateReceivedPacketLoss(inbound);
  const uplinkPacketLossPct =
    readMetricNumber(adaptive, "intervalUplinkPacketLossPct") ??
    calculateUplinkPacketLoss(remoteInbound, outbound);
  const packetLossPct =
    readMetricNumber(adaptive, "intervalPacketLossPct") ??
    maximumAvailable(downlinkPacketLossPct, uplinkPacketLossPct);
  const concealmentPct = readMetricNumber(adaptive, "concealmentPct");
  const jitterBufferDelayMs = readMetricNumber(adaptive, "jitterBufferDelayMs");
  const rttSeconds =
    readMetricNumber(candidatePair, "currentRoundTripTime") ??
    readMetricNumber(remoteInbound, "roundTripTime");
  const rttMs =
    readMetricNumber(adaptive, "smoothedRttMs") ?? (rttSeconds === null ? null : rttSeconds * 1000);
  const iceState = metrics.iceConnectionState || null;

  const issues: CallQualityIssue[] = [];
  const jitterSeverity = issueSeverity(jitterMs, 20, 30);
  const packetLossSeverity = issueSeverity(packetLossPct, 1, 3);
  const concealmentSeverity = issueSeverity(concealmentPct, 2, 5);
  const rttSeverity = issueSeverity(rttMs, 200, 400);

  if (iceState === "failed") {
    issues.push({ id: "ice", severity: "poor", value: iceState });
  } else if (iceState === "disconnected" || iceState === "checking") {
    issues.push({ id: "ice", severity: "fair", value: iceState });
  }

  if (jitterSeverity && jitterMs !== null) {
    issues.push({ id: "jitter", severity: jitterSeverity, value: `${Math.round(jitterMs)}ms` });
  }

  if (packetLossSeverity && packetLossPct !== null) {
    issues.push({
      id: "packetLoss",
      severity: packetLossSeverity,
      value: `${packetLossPct.toFixed(1)}%`,
    });
  }

  if (concealmentSeverity && concealmentPct !== null) {
    issues.push({
      id: "concealment",
      severity: concealmentSeverity,
      value: `${concealmentPct.toFixed(1)}%`,
    });
  }

  if (rttSeverity && rttMs !== null) {
    issues.push({ id: "rtt", severity: rttSeverity, value: `${Math.round(rttMs)}ms` });
  }

  const details = [
    jitterMs === null ? null : formatMetric("Jitter", jitterMs, "ms"),
    downlinkPacketLossPct === null
      ? null
      : formatMetric("Down loss", downlinkPacketLossPct, "%", 1),
    uplinkPacketLossPct === null ? null : formatMetric("Up loss", uplinkPacketLossPct, "%", 1),
    downlinkPacketLossPct === null && uplinkPacketLossPct === null && packetLossPct !== null
      ? formatMetric("Loss", packetLossPct, "%", 1)
      : null,
    concealmentPct === null ? null : formatMetric("Concealed", concealmentPct, "%", 1),
    jitterBufferDelayMs === null ? null : formatMetric("Buffer", jitterBufferDelayMs, "ms"),
    rttMs === null ? null : formatMetric("RTT", rttMs, "ms"),
  ].filter(Boolean) as string[];

  if (!details.length && !issues.length) {
    return empty;
  }

  const quality = issues.some((issue) => issue.severity === "poor")
    ? "poor"
    : issues.some((issue) => issue.severity === "fair")
      ? "fair"
      : "good";

  return {
    quality,
    detail: details.join(" · "),
    metrics: {
      jitterMs,
      packetLossPct,
      downlinkPacketLossPct,
      uplinkPacketLossPct,
      concealmentPct,
      jitterBufferDelayMs,
      rttMs,
      iceState,
    },
    issues,
  };
};

export const getQualityClasses = (quality: CallQuality): string => {
  if (quality === "good") return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  if (quality === "fair") return "bg-amber-50 text-amber-700 ring-amber-100";
  if (quality === "poor") return "bg-rose-50 text-rose-700 ring-rose-100";
  return "bg-slate-100 text-slate-500 ring-slate-200";
};
