type RemoteAudioElement = Pick<HTMLAudioElement, "muted" | "pause" | "srcObject">;

export const shouldMuteRemoteAudio = (speakerEnabled: boolean, onHold: boolean): boolean =>
  !speakerEnabled || onHold;

export const detachRemoteAudioElement = (element: RemoteAudioElement | null): void => {
  if (!element) return;

  try {
    element.pause();
  } catch {
    // Best-effort cleanup for media elements that are already being removed.
  }

  try {
    element.srcObject = null;
  } catch {
    // Older browsers can reject srcObject writes during document teardown.
  }
};
