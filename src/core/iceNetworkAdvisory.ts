export const NETWORK_ADVISORY_EVENT = "telvoip:network-advisory";

export type NetworkAdvisoryReason = "vpn-detected" | "vpn-interference" | "udp-blocked";

export interface NetworkAdvisoryDetail {
  reason: NetworkAdvisoryReason;
  severity: "info" | "warning" | "error";
  vendor: string | null;
}

const ADVISORY_COOLDOWN_MS: Record<NetworkAdvisoryReason, number> = {
  "vpn-detected": Number.POSITIVE_INFINITY,
  "vpn-interference": 120_000,
  "udp-blocked": 120_000,
};

const DISCONNECTED_ADVISORY_DELAY_MS = 3_000;
const lastAdvisoryAt = new Map<NetworkAdvisoryReason, number>();

const dispatchAdvisory = (detail: NetworkAdvisoryDetail): void => {
  const last = lastAdvisoryAt.get(detail.reason);
  if (last !== undefined && Date.now() - last < ADVISORY_COOLDOWN_MS[detail.reason]) return;
  lastAdvisoryAt.set(detail.reason, Date.now());
  console.warn(`[ICE-PROBE] network advisory: ${detail.reason}`, detail);
  window.dispatchEvent(new CustomEvent<NetworkAdvisoryDetail>(NETWORK_ADVISORY_EVENT, { detail }));
};

const iceServerUrls = (server: RTCIceServer): string[] =>
  typeof server.urls === "string" ? [server.urls] : Array.from(server.urls ?? []);

const expectsPublicCandidate = (servers: readonly RTCIceServer[] | undefined): boolean =>
  Boolean(
    servers?.some((server) => iceServerUrls(server).some((url) => /^(stun|turn)s?:/i.test(url)))
  );

const candidateAddress = (candidate: RTCIceCandidate): string | null => {
  if (candidate.address) return candidate.address;
  const fields = candidate.candidate.trim().split(/\s+/);
  return fields.length >= 6 ? fields[4] : null;
};

const candidateType = (candidate: RTCIceCandidate): RTCIceCandidateType | null => {
  if (candidate.type) return candidate.type;
  const match = candidate.candidate.match(/\btyp\s+(host|srflx|prflx|relay)(?:\s|$)/i);
  return match ? (match[1].toLowerCase() as RTCIceCandidateType) : null;
};

const isUnroutableForPublicServer = (address: string): boolean => {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (/^(fc|fd)/.test(normalized) || normalized.startsWith("fe80:")) return true;

  const octets = normalized.split(".");
  if (octets.length !== 4) return false;
  const first = Number(octets[0]);
  const second = Number(octets[1]);
  return (first === 100 && second >= 64 && second <= 127) || (first === 169 && second === 254);
};

const vpnVendor = (address: string): string | null =>
  address
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .startsWith("fd7a:115c:a1e0")
    ? "Tailscale"
    : null;

export interface IceNetworkAdvisoryRuntime {
  emit: (detail: NetworkAdvisoryDetail) => void;
  schedule: (callback: () => void, delayMs: number) => number;
  cancel: (timer: number) => void;
}

/**
 * Observes one concrete peer connection. It never replaces constructors,
 * changes descriptions, or logs candidate strings/addresses.
 */
export const bindIceNetworkAdvisories = (
  connection: RTCPeerConnection,
  servers: readonly RTCIceServer[] | undefined,
  runtime?: Partial<IceNetworkAdvisoryRuntime>
): (() => void) => {
  const emit = runtime?.emit ?? dispatchAdvisory;
  const schedule =
    runtime?.schedule ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
  const cancel = runtime?.cancel ?? ((timer) => window.clearTimeout(timer));
  const expectsPublic = expectsPublicCandidate(servers);
  let sawVpnCandidate = false;
  let sawPublicCandidate = false;
  let lastKnownVpnVendor: string | null = null;
  let disconnectedTimer: number | null = null;

  const clearDisconnectedTimer = () => {
    if (disconnectedTimer === null) return;
    cancel(disconnectedTimer);
    disconnectedTimer = null;
  };

  const onIceCandidate = (event: Event) => {
    const candidate = (event as RTCPeerConnectionIceEvent).candidate;
    if (!candidate) return;

    const type = candidateType(candidate);
    if (type === "srflx" || type === "relay") sawPublicCandidate = true;

    const address = candidateAddress(candidate);
    if (!address || !isUnroutableForPublicServer(address)) return;
    sawVpnCandidate = true;
    lastKnownVpnVendor = vpnVendor(address) ?? lastKnownVpnVendor;
    emit({
      reason: "vpn-detected",
      severity: "info",
      vendor: lastKnownVpnVendor,
    });
  };

  const onIceGatheringStateChange = () => {
    if (connection.iceGatheringState === "complete" && expectsPublic && !sawPublicCandidate) {
      emit({ reason: "udp-blocked", severity: "warning", vendor: null });
    }
  };

  const onIceConnectionStateChange = () => {
    const state = connection.iceConnectionState;
    if (state !== "disconnected") clearDisconnectedTimer();

    if (state === "failed") {
      if (sawVpnCandidate) {
        emit({
          reason: "vpn-interference",
          severity: "error",
          vendor: lastKnownVpnVendor,
        });
      } else if (expectsPublic && !sawPublicCandidate) {
        emit({ reason: "udp-blocked", severity: "error", vendor: null });
      }
      return;
    }

    if (state !== "disconnected" || !sawVpnCandidate || disconnectedTimer !== null) return;
    disconnectedTimer = schedule(() => {
      disconnectedTimer = null;
      if (
        connection.iceConnectionState !== "connected" &&
        connection.iceConnectionState !== "completed"
      ) {
        emit({
          reason: "vpn-interference",
          severity: "warning",
          vendor: lastKnownVpnVendor,
        });
      }
    }, DISCONNECTED_ADVISORY_DELAY_MS);
  };

  connection.addEventListener("icecandidate", onIceCandidate);
  connection.addEventListener("icegatheringstatechange", onIceGatheringStateChange);
  // Capture runs before JsSIP's non-capture failure listener terminates the
  // session and executes session cleanup.
  connection.addEventListener("iceconnectionstatechange", onIceConnectionStateChange, true);

  return () => {
    clearDisconnectedTimer();
    connection.removeEventListener("icecandidate", onIceCandidate);
    connection.removeEventListener("icegatheringstatechange", onIceGatheringStateChange);
    connection.removeEventListener("iceconnectionstatechange", onIceConnectionStateChange, true);
  };
};
