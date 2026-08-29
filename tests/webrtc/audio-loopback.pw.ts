import { expect, test } from "@playwright/test";

test("captures fake microphone audio and completes a peer connection", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const waitForGathering = (connection: RTCPeerConnection) =>
      new Promise<void>((resolve) => {
        if (connection.iceGatheringState === "complete") {
          resolve();
          return;
        }
        const listener = () => {
          if (connection.iceGatheringState !== "complete") return;
          connection.removeEventListener("icegatheringstatechange", listener);
          resolve();
        };
        connection.addEventListener("icegatheringstatechange", listener);
      });

    const waitForConnected = (connection: RTCPeerConnection) =>
      new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("ICE did not connect")), 10_000);
        const listener = () => {
          if (connection.connectionState !== "connected") return;
          window.clearTimeout(timeout);
          connection.removeEventListener("connectionstatechange", listener);
          resolve();
        };
        connection.addEventListener("connectionstatechange", listener);
        listener();
      });

    const localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: { ideal: true },
        autoGainControl: { ideal: true },
        noiseSuppression: { ideal: true },
        channelCount: { ideal: 1 },
      },
      video: false,
    });
    const caller = new RTCPeerConnection();
    const callee = new RTCPeerConnection();

    try {
      const localTrack = localStream.getAudioTracks()[0];
      if (!localTrack) throw new Error("Fake microphone did not provide an audio track");
      caller.addTrack(localTrack, localStream);

      const remoteStreamPromise = new Promise<MediaStream>((resolve) => {
        callee.addEventListener(
          "track",
          (event) => resolve(event.streams[0] ?? new MediaStream([event.track])),
          { once: true }
        );
      });

      await caller.setLocalDescription(await caller.createOffer());
      await waitForGathering(caller);
      await callee.setRemoteDescription(caller.localDescription!);
      await callee.setLocalDescription(await callee.createAnswer());
      await waitForGathering(callee);
      await caller.setRemoteDescription(callee.localDescription!);

      const remoteStream = await remoteStreamPromise;
      await Promise.all([waitForConnected(caller), waitForConnected(callee)]);

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.srcObject = remoteStream;
      document.body.appendChild(audio);
      await audio.play();

      await new Promise((resolve) => window.setTimeout(resolve, 500));
      const senderStats = await caller.getStats(localTrack);
      const receiverStats = await callee.getStats(remoteStream.getAudioTracks()[0]);
      const outbound = Array.from(senderStats.values()).find(
        (entry) => entry.type === "outbound-rtp" && entry.kind === "audio"
      );
      const inbound = Array.from(receiverStats.values()).find(
        (entry) => entry.type === "inbound-rtp" && entry.kind === "audio"
      );
      const devices = await navigator.mediaDevices.enumerateDevices();

      return {
        localTrackState: localTrack.readyState,
        remoteTrackState: remoteStream.getAudioTracks()[0]?.readyState,
        connectionState: caller.connectionState,
        audioElements: document.querySelectorAll("audio").length,
        audioPaused: audio.paused,
        bytesSent: Number(outbound?.bytesSent ?? 0),
        packetsReceived: Number(inbound?.packetsReceived ?? 0),
        audioInputs: devices.filter((device) => device.kind === "audioinput").length,
      };
    } finally {
      localStream.getTracks().forEach((track) => track.stop());
      caller.close();
      callee.close();
    }
  });

  expect(result).toMatchObject({
    localTrackState: "live",
    remoteTrackState: "live",
    connectionState: "connected",
    audioElements: 1,
    audioPaused: false,
  });
  expect(result.bytesSent).toBeGreaterThan(0);
  expect(result.packetsReceived).toBeGreaterThan(0);
  expect(result.audioInputs).toBeGreaterThan(0);
});
