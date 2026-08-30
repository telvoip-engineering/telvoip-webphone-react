"use client";

import { useContext, useEffect, useMemo, useRef } from "react";
import useSIPClient from "../core/useSIPClient";
import {
  SipActionsContext,
  SipContext,
  mapState,
  normalizeCredentials,
  type SipActions,
  type SipContextValue,
  type SipProviderProps,
} from "./SipContext.shared";

export { SipActionsContext, SipContext, normalizeCredentials } from "./SipContext.shared";
export type {
  NormalizedSipCredentials,
  SipActions,
  SipCallStatus,
  SipContextValue,
  SipCredentialsInput,
  SipProviderProps,
  SipRemoteIdentity,
  SipState,
} from "./SipContext.shared";

export const SipProvider = ({
  credentials,
  children,
  onCallSummary,
  onRegistrationFailed,
}: SipProviderProps) => {
  const normalized = useMemo(() => normalizeCredentials(credentials), [credentials]);
  const sip = useSIPClient(normalized || {}, { onCallSummary, onRegistrationFailed });

  // useSIPClient returns a fresh object every render, so anything derived from
  // `sip` directly is unstable. Route actions through a ref so the actions
  // object is created exactly once and always calls the latest client.
  const sipRef = useRef(sip);

  useEffect(() => {
    sipRef.current = sip;
  }, [sip]);

  const stableActions = useMemo<SipActions>(
    () => ({
      setRegistrationEnabled: (enabled) => sipRef.current.setRegistrationEnabled(enabled),
      refreshDevices: () => sipRef.current.refreshDevices(),
      selectInputDevice: (deviceId) => sipRef.current.selectInputDevice(deviceId),
      selectOutputDevice: (deviceId) => sipRef.current.selectOutputDevice(deviceId),
      reconnect: () => sipRef.current.reconnect(),
      startCall: (target) => sipRef.current.makeCall(target),
      hangup: () => sipRef.current.endCall(),
      answer: () => sipRef.current.answerCall(),
      reject: () => sipRef.current.rejectCall(),
      sendDtmf: (tones) => sipRef.current.sendDtmf(tones),
      toggleMute: () => sipRef.current.toggleMute(),
      toggleHold: () => sipRef.current.toggleHold(),
      transferCall: (target) => sipRef.current.transferCall(target),
      toggleSpeaker: () => sipRef.current.toggleSpeaker(),
      resumeSpeaker: () => sipRef.current.resumeSpeaker(),
      resumeCallTones: () => sipRef.current.resumeCallTones(),
      setIncomingRingtone: (id) => sipRef.current.setIncomingRingtone(id),
      previewIncomingRingtone: (id) => sipRef.current.previewIncomingRingtone(id),
      testSpeaker: () => sipRef.current.testSpeaker(),
      registerAudioElement: (element) => sipRef.current.registerAudioElement(element),
      startSelfTest: () => sipRef.current.startSelfTest(),
      stopSelfTest: (reason) => sipRef.current.stopSelfTest(reason),
      skipWrapUp: () => sipRef.current.skipWrapUp(),
      extendWrapUp: () => sipRef.current.extendWrapUp(),
      setNoiseSuppression: (enabled) => sipRef.current.setNoiseSuppression(enabled),
    }),
    []
  );

  const value = useMemo<SipContextValue>(
    () => ({
      state: mapState(sip),
      actions: stableActions,
      credentials: normalized,
    }),
    [sip, normalized, stableActions]
  );

  return (
    <SipActionsContext.Provider value={stableActions}>
      <SipContext.Provider value={value}>{children}</SipContext.Provider>
    </SipActionsContext.Provider>
  );
};

export const useSip = (): SipContextValue | null => useContext(SipContext);

/**
 * Actions without state: referentially stable, never re-renders on call ticks.
 * Falls back to the full context's actions under providers that don't publish
 * SipActionsContext.
 */
export const useSipActions = (): SipActions | null => {
  // Both calls are unconditional (unlike the React 19 `use()` this was
  // ported from, `useContext` must not be called conditionally) - the
  // fallback is just which *result* we prefer, not which hook fires.
  const actions = useContext(SipActionsContext);
  const fullContext = useContext(SipContext);
  return actions ?? fullContext?.actions ?? null;
};
