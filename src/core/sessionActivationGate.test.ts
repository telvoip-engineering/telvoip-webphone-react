import { describe, expect, mock, test } from "bun:test";
import { createSessionActivationGate } from "./sessionActivationGate";

const connection = (state: RTCPeerConnectionState): RTCPeerConnection =>
  ({ connectionState: state, iceConnectionState: "connected" }) as RTCPeerConnection;

describe("createSessionActivationGate", () => {
  test("activates only after accepted, confirmed, and fully connected media", () => {
    const onActivate = mock(() => {});
    const gate = createSessionActivationGate(onActivate);
    const peer = connection("connecting");

    gate.markAccepted(peer);
    gate.markConfirmed(peer);
    expect(onActivate).not.toHaveBeenCalled();

    Object.assign(peer, { connectionState: "connected" });
    gate.syncMedia(peer);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  test("handles media connecting before the SIP ACK", () => {
    const onActivate = mock(() => {});
    const gate = createSessionActivationGate(onActivate);
    const peer = connection("connected");

    gate.syncMedia(peer);
    gate.markAccepted(peer);
    expect(onActivate).not.toHaveBeenCalled();

    gate.markConfirmed(peer);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  test("accepts verified bidirectional RTP while aggregate ICE is still checking", () => {
    const onActivate = mock(() => {});
    const gate = createSessionActivationGate(onActivate);
    const peer = connection("connecting");

    gate.markAccepted(peer);
    gate.markConfirmed(peer);
    gate.markMediaFlowing();

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  test("RTP evidence still waits for SIP confirmation", () => {
    const onActivate = mock(() => {});
    const gate = createSessionActivationGate(onActivate);

    gate.markAccepted(connection("connecting"));
    gate.markMediaFlowing();
    expect(onActivate).not.toHaveBeenCalled();

    gate.markConfirmed(connection("connecting"));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  test("can start the watchdog before SIP acceptance", async () => {
    const onActivationTimeout = mock(() => {});
    const gate = createSessionActivationGate(() => {}, {
      activationTimeoutMs: 5,
      onActivationTimeout,
    });

    gate.start();
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(onActivationTimeout).toHaveBeenCalledTimes(1);
  });

  test("reports aggregate peer-connection failure only once", () => {
    const onActivate = mock(() => {});
    const onConnectivityFailure = mock(() => {});
    const gate = createSessionActivationGate(onActivate, { onConnectivityFailure });
    const peer = connection("connecting");

    gate.start();
    gate.markAccepted(peer);
    gate.markConfirmed(peer);
    Object.assign(peer, { connectionState: "failed" });
    gate.syncMedia(peer);
    gate.syncMedia(peer);

    expect(onConnectivityFailure).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  test("reports aggregate failure after activation", () => {
    const onConnectivityFailure = mock(() => {});
    const gate = createSessionActivationGate(() => {}, { onConnectivityFailure });
    const peer = connection("connected");

    gate.markAccepted(peer);
    gate.markConfirmed(peer);
    Object.assign(peer, { connectionState: "failed" });
    gate.syncMedia(peer);

    expect(onConnectivityFailure).toHaveBeenCalledTimes(1);
  });

  test("reports connectivity failure without preventing a later recovery", () => {
    const onActivate = mock(() => {});
    const onConnectivityFailure = mock(() => {});
    const gate = createSessionActivationGate(onActivate, { onConnectivityFailure });
    const peer = connection("connecting");

    gate.markAccepted(peer);
    gate.markConfirmed(peer);
    Object.assign(peer, { connectionState: "failed" });
    gate.syncMedia(peer);
    Object.assign(peer, { connectionState: "connected" });
    gate.syncMedia(peer);

    expect(onConnectivityFailure).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  test("reports a timeout without blocking later activation", async () => {
    const onActivate = mock(() => {});
    const onActivationTimeout = mock(() => {});
    const gate = createSessionActivationGate(onActivate, {
      activationTimeoutMs: 5,
      onActivationTimeout,
    });

    gate.markAccepted(connection("connecting"));
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(onActivationTimeout).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();

    gate.markConfirmed(connection("connected"));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  test("clears the activation timeout after connecting", async () => {
    const onActivate = mock(() => {});
    const onActivationTimeout = mock(() => {});
    const gate = createSessionActivationGate(onActivate, {
      activationTimeoutMs: 5,
      onActivationTimeout,
    });
    const peer = connection("connected");

    gate.markAccepted(peer);
    gate.markConfirmed(peer);
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivationTimeout).not.toHaveBeenCalled();
  });

  test("dispose cancels the activation timeout", async () => {
    const onActivationTimeout = mock(() => {});
    const gate = createSessionActivationGate(() => {}, {
      activationTimeoutMs: 5,
      onActivationTimeout,
    });

    gate.markAccepted(connection("connecting"));
    gate.dispose();
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(onActivationTimeout).not.toHaveBeenCalled();
  });

  test("never activates more than once", () => {
    const onActivate = mock(() => {});
    const gate = createSessionActivationGate(onActivate);
    const peer = connection("connected");

    gate.markAccepted(peer);
    gate.markConfirmed(peer);
    gate.syncMedia(peer);
    gate.markMediaFlowing();
    gate.markConfirmed(peer);

    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
