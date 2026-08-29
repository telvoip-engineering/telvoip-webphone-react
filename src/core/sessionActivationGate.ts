export type SessionActivationGate = {
  markAccepted: (connection?: RTCPeerConnection | null) => void;
  markConfirmed: (connection?: RTCPeerConnection | null) => void;
  markMediaFlowing: () => void;
  start: () => void;
  syncMedia: (connection?: RTCPeerConnection | null) => void;
  dispose: () => void;
};

type SessionActivationGateOptions = {
  activationTimeoutMs?: number;
  onActivationTimeout?: () => void;
  onConnectivityFailure?: () => void;
};

export const createSessionActivationGate = (
  onActivate: () => void,
  options: SessionActivationGateOptions = {}
): SessionActivationGate => {
  let accepted = false;
  let confirmed = false;
  let mediaConnected = false;
  let mediaFlowing = false;
  let activated = false;
  let disposed = false;
  let activationTimeoutReported = false;
  let connectivityFailureReported = false;
  let activationTimeout: ReturnType<typeof setTimeout> | null = null;

  const clearActivationTimeout = () => {
    if (activationTimeout === null) return;
    clearTimeout(activationTimeout);
    activationTimeout = null;
  };

  // SIP confirmation remains mandatory. Some PBXs deliver working RTP while
  // Firefox keeps the aggregate peer connection in "checking", so verified
  // bidirectional packet flow is also valid media evidence.
  const maybeActivate = () => {
    if (disposed || activated || !accepted || !confirmed || (!mediaConnected && !mediaFlowing)) {
      return;
    }
    activated = true;
    clearActivationTimeout();
    onActivate();
  };

  const startActivationTimeout = () => {
    const timeoutMs = options.activationTimeoutMs;
    if (
      disposed ||
      activated ||
      activationTimeoutReported ||
      activationTimeout !== null ||
      typeof timeoutMs !== "number" ||
      timeoutMs <= 0 ||
      !options.onActivationTimeout
    ) {
      return;
    }
    activationTimeout = setTimeout(() => {
      activationTimeout = null;
      if (disposed || activated) return;
      activationTimeoutReported = true;
      options.onActivationTimeout?.();
    }, timeoutMs);
  };

  const syncMedia = (connection?: RTCPeerConnection | null) => {
    if (!connection || disposed) return;
    const supportsConnectionState = typeof connection.connectionState === "string";
    if (
      supportsConnectionState &&
      connection.connectionState === "failed" &&
      options.onConnectivityFailure
    ) {
      mediaConnected = false;
      if (!connectivityFailureReported) {
        connectivityFailureReported = true;
        options.onConnectivityFailure();
      }
      return;
    }
    if (connection.connectionState !== "failed") {
      connectivityFailureReported = false;
    }
    mediaConnected = supportsConnectionState
      ? connection.connectionState === "connected"
      : connection.iceConnectionState === "connected" ||
        connection.iceConnectionState === "completed";
    if (activated && mediaConnected) {
      clearActivationTimeout();
    }
    maybeActivate();
  };

  return {
    start: startActivationTimeout,
    markAccepted: (connection) => {
      accepted = true;
      startActivationTimeout();
      syncMedia(connection);
      maybeActivate();
    },
    markConfirmed: (connection) => {
      confirmed = true;
      syncMedia(connection);
      maybeActivate();
    },
    markMediaFlowing: () => {
      mediaFlowing = true;
      maybeActivate();
    },
    syncMedia,
    dispose: () => {
      disposed = true;
      clearActivationTimeout();
    },
  };
};
