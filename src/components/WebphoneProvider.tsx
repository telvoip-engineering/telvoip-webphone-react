"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { SipProvider, useSip, type SipCredentialsInput } from "../context/SipContext";
import { hasStunIceServer } from "../core/iceConfig";
import type { DialTargetFormat } from "../core/dialTarget";
import type { DialTargetFormatter } from "../core/dialTarget";
import type { CountryCode } from "libphonenumber-js/min";

// A generic, well-known public STUN server - NOT Telvoip's own infrastructure
// (the source app defaults to its own TURN server, which would be
// inappropriate to bake into a package used by non-Telvoip consumers).
// Only added when the caller's own credentials don't already include a STUN
// server; ICE gathering behind NAT typically needs at least one to succeed.
const FALLBACK_STUN_ICE_SERVER: RTCIceServer = { urls: "stun:stun.l.google.com:19302" };

export interface WebphoneProviderProps {
  credentials: SipCredentialsInput;
  children: ReactNode;
  onCallSummary?: (summary: unknown) => void | Promise<void>;
  onRegistrationFailed?: (cause?: unknown) => void;
  dialTargetFormat?: DialTargetFormat;
  defaultCallingCountry?: CountryCode;
  formatDialTarget?: DialTargetFormatter;
}

/**
 * Composition root: establishes the SIP context and owns the single shared
 * `<audio>` element every call plays through. Does not render `<Dialer />`
 * itself - mount that separately, wherever you want it in the tree, so a
 * fully headless integration (useSip()/useSipActions() only) doesn't pay
 * for UI it never renders.
 */
export default function WebphoneProvider({
  credentials,
  children,
  onCallSummary,
  onRegistrationFailed,
  dialTargetFormat,
  defaultCallingCountry,
  formatDialTarget,
}: WebphoneProviderProps) {
  const resolvedCredentials = useMemo<SipCredentialsInput>(
    () => ({
      ...credentials,
      sipIceServers: hasStunIceServer(credentials.sipIceServers)
        ? credentials.sipIceServers
        : [FALLBACK_STUN_ICE_SERVER, ...(credentials.sipIceServers ?? [])],
    }),
    [credentials]
  );

  return (
    <SipProvider
      credentials={resolvedCredentials}
      onCallSummary={onCallSummary}
      onRegistrationFailed={onRegistrationFailed}
      dialTargetFormat={dialTargetFormat}
      defaultCallingCountry={defaultCallingCountry}
      formatDialTarget={formatDialTarget}
    >
      <WebphoneAudioBridge />
      {children}
    </SipProvider>
  );
}

const WebphoneAudioBridge = () => {
  const sip = useSip();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const registerAudioElement = sip?.actions?.registerAudioElement;

  useEffect(() => {
    if (!registerAudioElement) return undefined;
    registerAudioElement(audioRef.current);
    return () => registerAudioElement(null);
  }, [registerAudioElement]);

  return (
    <audio ref={audioRef} hidden autoPlay playsInline>
      <track kind="captions" src="data:text/vtt,WEBVTT" label="Call audio" default />
    </audio>
  );
};
