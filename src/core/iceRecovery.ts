// Preserve the pre-recovery safeguard. SIP carries a complete SDP rather than
// trickling candidates, so forcing readiness sooner can permanently omit a
// usable server-reflexive candidate from the offer/answer.
export const DEFAULT_ICE_GATHERING_WATCHDOG_MS = 10_000;
export const RELAY_ICE_GATHERING_WATCHDOG_MS = 10_000;
export const ICE_DISCONNECTED_RESTART_DELAY_MS = 3_000;
export const ICE_RESTART_READINESS_RETRY_DELAY_MS = 1_000;
export const MAX_ICE_RESTART_ATTEMPTS = 1;
export const MAX_ICE_RESTART_READINESS_RETRIES = 10;

const iceServerUrls = (server: RTCIceServer): string[] =>
  typeof server.urls === "string" ? [server.urls] : Array.from(server.urls ?? []);

/**
 * Non-trickle SIP must wait for candidates to be embedded in the SDP. Keep the
 * full conservative window for STUN and TURN; returning sooner freezes an
 * incomplete candidate set into the SIP offer/answer.
 */
export const getIceGatheringWatchdogMs = (servers: readonly RTCIceServer[] | undefined): number =>
  servers?.some((server) => iceServerUrls(server).some((url) => /^turns?:/i.test(url)))
    ? RELAY_ICE_GATHERING_WATCHDOG_MS
    : DEFAULT_ICE_GATHERING_WATCHDOG_MS;

export interface IceRestartEligibility {
  iceState: RTCIceConnectionState;
  sessionEstablished: boolean;
  readyToReOffer: boolean;
  attempts: number;
}

export interface IceRestartReadinessRetry {
  iceState: RTCIceConnectionState;
  sessionEstablished: boolean;
  attempts: number;
  readinessRetries: number;
}

/** A restart is useful only for an established dialog that can send a re-INVITE. */
export const shouldAttemptIceRestart = ({
  iceState,
  sessionEstablished,
  readyToReOffer,
  attempts,
}: IceRestartEligibility): boolean =>
  iceState === "disconnected" &&
  sessionEstablished &&
  readyToReOffer &&
  attempts < MAX_ICE_RESTART_ATTEMPTS;

/**
 * A pending in-dialog INVITE/UPDATE can make JsSIP temporarily unavailable for
 * a re-offer. Keep checking for a short, bounded period while ICE is still
 * disconnected instead of abandoning recovery until another state event.
 */
export const shouldRetryIceRestartReadiness = ({
  iceState,
  sessionEstablished,
  attempts,
  readinessRetries,
}: IceRestartReadinessRetry): boolean =>
  iceState === "disconnected" &&
  sessionEstablished &&
  attempts < MAX_ICE_RESTART_ATTEMPTS &&
  readinessRetries < MAX_ICE_RESTART_READINESS_RETRIES;

export interface SdpIceConnectivitySummary {
  connectionLineCount: number;
  candidateCount: number;
  candidateTypes: Record<string, number>;
  protocols: Record<string, number>;
}

export interface IceServerUrlSummary {
  scheme: "stun" | "turn" | "turns" | null;
  transport: "tcp" | "udp" | null;
}

/** Avoids placing the ICE server hostname/address and port in production logs. */
export const summarizeIceServerUrl = (url: string | undefined): IceServerUrlSummary => {
  const schemeMatch = url?.trim().match(/^(stun|turn|turns):/i);
  const transportMatch = url?.match(/[?&]transport=(tcp|udp)(?:&|$)/i);
  return {
    scheme: schemeMatch ? (schemeMatch[1].toLowerCase() as IceServerUrlSummary["scheme"]) : null,
    transport: transportMatch
      ? (transportMatch[1].toLowerCase() as IceServerUrlSummary["transport"])
      : null,
  };
};

const increment = (counts: Record<string, number>, value: string | undefined): void => {
  if (!value) return;
  const normalized = value.toLowerCase();
  counts[normalized] = (counts[normalized] ?? 0) + 1;
};

/** Returns useful ICE shape without retaining candidate addresses or ports. */
export const summarizeSdpIceConnectivity = (
  sdp: string | undefined | null
): SdpIceConnectivitySummary => {
  const summary: SdpIceConnectivitySummary = {
    connectionLineCount: 0,
    candidateCount: 0,
    candidateTypes: {},
    protocols: {},
  };
  if (!sdp) return summary;

  for (const line of sdp.split(/\r?\n/)) {
    if (line.startsWith("c=")) {
      summary.connectionLineCount += 1;
      continue;
    }
    if (!line.startsWith("a=candidate:")) continue;

    const fields = line.trim().split(/\s+/);
    const typeIndex = fields.findIndex((field) => field.toLowerCase() === "typ");
    summary.candidateCount += 1;
    increment(summary.protocols, fields[2]);
    increment(summary.candidateTypes, typeIndex >= 0 ? fields[typeIndex + 1] : undefined);
  }

  return summary;
};
