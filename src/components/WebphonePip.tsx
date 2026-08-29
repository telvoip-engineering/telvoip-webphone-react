"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSip } from "../context/SipContext";
import { type DialerLabels, resolveLabels } from "./labels";
import {
  HoldIcon,
  MicIcon,
  MicOffIcon,
  PhoneHangupIcon,
  PhoneIcon,
} from "./primitives/icons";

type DocumentPipOptions = {
  width?: number;
  height?: number;
  disallowReturnToOpener?: boolean;
};

type DocumentPictureInPictureApi = {
  requestWindow: (options?: DocumentPipOptions) => Promise<Window>;
};

const getDocumentPipApi = (): DocumentPictureInPictureApi | null => {
  if (typeof window === "undefined") return null;
  return (
    (window as Window & { documentPictureInPicture?: DocumentPictureInPictureApi })
      .documentPictureInPicture ?? null
  );
};

// The PiP window starts with an empty document: copy the host page's
// stylesheets (including this package's own dist/style.css, however the
// consumer loaded it) and root theme attributes so classes render
// identically inside it.
const copyStylesInto = (target: Window) => {
  Array.from(document.styleSheets).forEach((sheet) => {
    try {
      const rules = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("");
      const style = target.document.createElement("style");
      style.textContent = rules;
      target.document.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = target.document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.document.head.appendChild(link);
      }
    }
  });

  target.document.documentElement.className = document.documentElement.className;
  const rootStyle = document.documentElement.getAttribute("style");
  if (rootStyle) target.document.documentElement.setAttribute("style", rootStyle);
};

const PIP_WINDOW_WIDTH = 288;
const PIP_WINDOW_HEIGHT = 232;

/**
 * Manages a Document Picture-in-Picture window (Chromium-only) that stays on
 * top of every app, not just this tab. Render call controls into it with
 * createPortal(..., pipWindow.document.body).
 */
export const useWebphonePip = ({ callActive = false }: { callActive?: boolean } = {}) => {
  const [supported, setSupported] = useState(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const pipWindowRef = useRef<Window | null>(null);
  const autoOpenedRef = useRef(false);
  // A window popped out while idle is a persistent dock the agent keeps
  // around to receive calls anywhere; it survives call teardown.
  const openedWhileIdleRef = useRef(false);
  const callActiveRef = useRef(callActive);
  callActiveRef.current = callActive;

  useEffect(() => {
    setSupported(Boolean(getDocumentPipApi()));
    return () => {
      pipWindowRef.current?.close();
      pipWindowRef.current = null;
    };
  }, []);

  const closePip = useCallback(() => {
    pipWindowRef.current?.close();
    pipWindowRef.current = null;
    autoOpenedRef.current = false;
    openedWhileIdleRef.current = false;
    setPipWindow(null);
  }, []);

  const openPip = useCallback(async (auto = false) => {
    const api = getDocumentPipApi();
    if (!api || pipWindowRef.current) return;

    try {
      const win = await api.requestWindow({
        width: PIP_WINDOW_WIDTH,
        height: PIP_WINDOW_HEIGHT,
      });
      copyStylesInto(win);
      win.document.title = "Webphone";
      win.document.body.className = "twp-root overflow-hidden bg-white";
      win.addEventListener("pagehide", () => {
        pipWindowRef.current = null;
        autoOpenedRef.current = false;
        openedWhileIdleRef.current = false;
        setPipWindow(null);
      });
      pipWindowRef.current = win;
      autoOpenedRef.current = auto;
      openedWhileIdleRef.current = !auto && !callActiveRef.current;
      setPipWindow(win);
    } catch (error) {
      console.warn("[webphone-react] Unable to open the floating call window", error);
    }
  }, []);

  // Automatic PiP (Chromium 120+): while this page captures the microphone
  // (i.e. during a call in the tab that owns the SIP client), Chrome fires
  // this media-session action as the user switches to another tab or app,
  // allowing the floating phone to open without a click.
  useEffect(() => {
    if (!supported || !callActive) return undefined;
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return undefined;

    try {
      navigator.mediaSession.setActionHandler("enterpictureinpicture" as MediaSessionAction, () => {
        void openPip(true);
      });
    } catch {
      // This browser does not know the action; manual pop-out still works.
      return undefined;
    }

    return () => {
      try {
        navigator.mediaSession.setActionHandler(
          "enterpictureinpicture" as MediaSessionAction,
          null
        );
      } catch {
        // Ignore: handler was never registered.
      }
    };
  }, [supported, callActive, openPip]);

  // A window opened for a call closes once the call ends; a persistent dock
  // opened while idle stays so incoming calls can surface in it anywhere.
  const prevCallActiveRef = useRef(callActive);
  useEffect(() => {
    if (prevCallActiveRef.current && !callActive && !openedWhileIdleRef.current) {
      closePip();
    }
    prevCallActiveRef.current = callActive;
  }, [callActive, closePip]);

  // Close an auto-opened window when the user returns to this tab; windows
  // the user opened via the pop-out button stay until closed explicitly.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && autoOpenedRef.current) {
        closePip();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [closePip]);

  return { supported, pipWindow, openPip, closePip };
};

const formatPipDuration = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, mins, s].map((n) => n.toString().padStart(2, "0")).join(":");
};

const PIP_ACTIVE_STATUSES = new Set(["dialing", "ringing", "incoming", "in-call", "connecting"]);

const pipButtonClass = (appearance: "default" | "positive" | "destructive", active = false) => {
  const base =
    "flex h-10 w-10 items-center justify-center rounded-full border text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  if (appearance === "positive") {
    return `${base} border-emerald-300 bg-emerald-500 text-white hover:bg-emerald-600`;
  }
  if (appearance === "destructive") {
    return `${base} border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100`;
  }
  return `${base} border-slate-200 ${
    active ? "bg-primary text-white" : "bg-white text-slate-600 hover:text-primary"
  }`;
};

export interface WebphonePipCardProps {
  labels?: Partial<DialerLabels>;
}

/**
 * Compact call card rendered inside the PiP window. Fills the window at any
 * size: header with connection status, centered caller identity, controls
 * docked at the bottom. Reads/acts through useSip(), so it works from any
 * portal target without its own state.
 */
export const WebphonePipCard = ({ labels: labelsOverride }: WebphonePipCardProps) => {
  const labels = resolveLabels(labelsOverride);
  const sip = useSip();
  const state = sip?.state;
  const actions = sip?.actions;

  const callStatus = state?.callStatus ?? "idle";
  const hasPendingCall = state?.pendingCallStatus === "incoming";
  const showAnswerControls = callStatus === "incoming" || hasPendingCall;
  const callActive = PIP_ACTIVE_STATUSES.has(callStatus) || hasPendingCall;
  const inCall = callStatus === "in-call";
  const isIncoming = showAnswerControls;
  const registered = Boolean(state?.registered);

  const remote = hasPendingCall ? state?.pendingCallRemote : state?.remoteIdentity;
  const remoteLabel = remote?.displayName || remote?.uri || labels.unknownCaller;

  const statusLabel = (() => {
    if (state?.onHold && inCall) return labels.hold;
    switch (callStatus) {
      case "dialing":
        return labels.call;
      case "ringing":
        return labels.callRinging;
      case "incoming":
        return labels.incomingCall;
      case "connecting":
        return labels.callConnecting;
      case "in-call":
        return formatPipDuration(state?.duration ?? 0);
      default:
        return hasPendingCall ? labels.incomingCall : "";
    }
  })();

  return (
    <div className="twp-root flex h-[100vh] w-full flex-col bg-white text-slate-800">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
            <PhoneIcon size={13} />
          </span>
          <span className="text-xs font-semibold">Webphone</span>
        </div>
        <span
          aria-live="polite"
          className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            registered ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${registered ? "bg-emerald-500" : "bg-slate-400"}`}
          />
          {registered ? labels.registered : labels.unregistered}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
        {callActive ? (
          <>
            <span
              className={`flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary ${
                isIncoming ? "animate-pulse" : ""
              }`}
            >
              <PhoneIcon size={20} />
            </span>
            <p className="mt-1 w-full truncate text-sm font-semibold" title={remoteLabel}>
              {remoteLabel}
            </p>
            <p className="text-xs font-medium tabular-nums text-slate-500">{statusLabel}</p>
          </>
        ) : (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <PhoneIcon size={20} />
            </span>
            <p className="mt-1 text-sm font-semibold text-slate-500">No active call</p>
          </>
        )}
      </div>

      {callActive ? (
        <div className="flex shrink-0 items-center justify-center gap-3 px-4 pb-4">
          {showAnswerControls ? (
            <>
              <button
                type="button"
                className={pipButtonClass("positive")}
                aria-label={labels.answer}
                title={labels.answer}
                onClick={() => void actions?.answer()}
              >
                <PhoneIcon size={17} />
              </button>
              <button
                type="button"
                className={pipButtonClass("destructive")}
                aria-label={labels.reject}
                title={labels.reject}
                onClick={() => actions?.reject()}
              >
                <PhoneHangupIcon size={17} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={pipButtonClass("default", Boolean(state?.muted))}
                aria-label={state?.muted ? labels.unmute : labels.mute}
                title={state?.muted ? labels.unmute : labels.mute}
                onClick={() => actions?.toggleMute()}
              >
                {state?.muted ? <MicOffIcon size={17} /> : <MicIcon size={17} />}
              </button>
              {inCall ? (
                <button
                  type="button"
                  className={pipButtonClass("default", Boolean(state?.onHold))}
                  aria-label={state?.onHold ? labels.unhold : labels.hold}
                  title={state?.onHold ? labels.unhold : labels.hold}
                  onClick={() => actions?.toggleHold()}
                >
                  <HoldIcon size={17} />
                </button>
              ) : null}
              <button
                type="button"
                className={pipButtonClass("destructive")}
                aria-label={labels.hangup}
                title={labels.hangup}
                onClick={() => actions?.hangup()}
              >
                <PhoneHangupIcon size={17} />
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};
