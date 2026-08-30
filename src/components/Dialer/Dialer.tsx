"use client";

import { useCallback, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { useSip } from "../../context/SipContext";
import { resolveLabels } from "../labels";
import type { DialerProps } from "../types";
import AudioSettingsPanel from "../primitives/AudioSettingsPanel";
import DialPad from "../primitives/DialPad";
import TransferPad from "../primitives/TransferPad";
import WrapUpCard from "../primitives/WrapUpCard";
import { DialpadIcon, HoldIcon, MicIcon, MicOffIcon, PhoneHangupIcon, PhoneIcon, PipIcon, SettingsIcon, TransferIcon, VolumeIcon, VolumeOffIcon } from "../primitives/icons";
import { useWebphonePip, WebphonePipCard } from "../WebphonePip";
import { createPortal } from "react-dom";
import DraggablePill from "./DraggablePill";
import IncomingCallBanner from "./IncomingCallBanner";

const ACTIVE_CALL_STATUSES = new Set(["dialing", "ringing", "connecting", "in-call"]);

const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

/**
 * Small circular icon button for the dark call-control bar - visually
 * distinct from the light-themed ControlButton primitive (used inside the
 * light popups: DialPad/TransferPad/AudioSettingsPanel/WrapUpCard), which
 * intentionally keeps its own default light palette since it's also
 * individually exported for consumers who want to reuse it standalone.
 */
function DarkIconButton({
  active = false,
  appearance = "default",
  onClick,
  title,
  children,
}: {
  active?: boolean;
  appearance?: "default" | "positive" | "destructive";
  onClick?: (e?: ReactMouseEvent<HTMLButtonElement>) => void;
  title?: string;
  children: ReactNode;
}) {
  const palette =
    appearance === "positive"
      ? "bg-emerald-500 text-white hover:bg-emerald-600"
      : appearance === "destructive"
        ? "bg-rose-500 text-white hover:bg-rose-600"
        : active
          ? "bg-white/20 text-white"
          : "bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white";
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${palette}`}
    >
      {children}
    </button>
  );
}

/** Generic avatar circle - no photo to show, so a consistent colored initial/icon stands in for one. */
function AvatarCircle({ label, size = 36 }: { label: string; size?: number }) {
  const initial = /^[a-z]/i.test(label.trim()) ? label.trim()[0]!.toUpperCase() : null;
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-600 to-slate-700 font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initial ?? <PhoneIcon size={size * 0.45} />}
    </div>
  );
}

export default function Dialer({
  draggable = true,
  corner = "bottom-right",
  labels: labelsOverride,
  onTransferSearch,
  transferCandidates,
  transferCandidatesLoading,
  className,
}: DialerProps) {
  const sip = useSip();
  const labels = resolveLabels(labelsOverride);
  const state = sip?.state;
  const actions = sip?.actions;

  const [expanded, setExpanded] = useState(false);
  const [dialPadOpen, setDialPadOpen] = useState(false);
  const [dialPadCoords, setDialPadCoords] = useState({ top: 0, left: 0 });
  const [dialInput, setDialInput] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferInput, setTransferInput] = useState("");
  const [selectedTransferTarget, setSelectedTransferTarget] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [audioDeviceMenu, setAudioDeviceMenu] = useState<"input" | "output" | null>(null);
  const [deviceSelecting, setDeviceSelecting] = useState<"input" | "output" | null>(null);
  const [speakerTestPlaying, setSpeakerTestPlaying] = useState(false);

  const callStatus = state?.callStatus ?? "idle";
  const hasPendingCall = state?.pendingCallStatus === "incoming";
  const showIncomingBanner = callStatus === "incoming" || hasPendingCall;
  const callActive = ACTIVE_CALL_STATUSES.has(callStatus) || hasPendingCall;
  const inCall = callStatus === "in-call";

  const pip = useWebphonePip({ callActive });

  const openDialPadAt = useCallback((trigger: HTMLElement | null) => {
    const rect = trigger?.getBoundingClientRect();
    if (rect) {
      setDialPadCoords({ top: rect.bottom + 8, left: Math.max(8, rect.right - 288) });
    }
    setDialPadOpen(true);
  }, []);

  const handleCall = useCallback(() => {
    if (!dialInput.trim()) return;
    void actions?.startCall(dialInput.trim());
    setDialInput("");
    setDialPadOpen(false);
  }, [actions, dialInput]);

  const handleTransfer = useCallback(async () => {
    const target = selectedTransferTarget || transferInput.trim();
    if (!target || !actions) return;
    setTransferLoading(true);
    try {
      await actions.transferCall(target);
      setTransferOpen(false);
      setTransferInput("");
      setSelectedTransferTarget("");
    } finally {
      setTransferLoading(false);
    }
  }, [actions, selectedTransferTarget, transferInput]);

  const handleDeviceSelect = useCallback(
    (kind: "input" | "output") => async (deviceId: string | null) => {
      setDeviceSelecting(kind);
      try {
        if (kind === "input") await actions?.selectInputDevice(deviceId);
        else await actions?.selectOutputDevice(deviceId);
      } finally {
        setDeviceSelecting(null);
      }
    },
    [actions]
  );

  if (!sip) return null;

  const remote = hasPendingCall ? state?.pendingCallRemote : state?.remoteIdentity;
  const remoteLabel = remote?.displayName || remote?.uri || labels.unknownCaller;

  const registrationLabel = state?.registering
    ? labels.registering
    : state?.registered
      ? labels.registered
      : labels.unregistered;

  const callStatusLabel =
    callStatus === "in-call"
      ? formatDuration(state?.duration ?? 0)
      : callStatus === "dialing"
        ? labels.callConnecting
        : callStatus === "ringing"
          ? labels.callRinging
          : callStatus === "connecting"
            ? labels.callConnecting
            : "";

  return (
    <DraggablePill draggable={draggable} corner={corner} className={className}>
      <div className="twp-root">
        {pip.pipWindow
          ? createPortal(<WebphonePipCard labels={labelsOverride} />, pip.pipWindow.document.body)
          : null}

        {showIncomingBanner ? (
          <IncomingCallBanner
            callerLabel={remoteLabel}
            onAnswer={() => void actions?.answer()}
            onReject={() => actions?.reject()}
            labels={labelsOverride}
          />
        ) : callActive ? (
          <div className="flex w-72 flex-col gap-1.5">
            {/* Top bar: identity + status + hangup, like a caller-ID card. */}
            <div className="flex items-center gap-2.5 rounded-2xl bg-slate-900 py-2 pl-2.5 pr-2 shadow-[0_18px_44px_rgba(15,23,42,0.35)]">
              <AvatarCircle label={remoteLabel} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-white">{remoteLabel}</p>
                <p className="truncate text-[11px] tabular-nums text-slate-400">
                  {state?.onHold ? labels.hold : callStatusLabel}
                </p>
              </div>
              <DarkIconButton appearance="destructive" onClick={() => actions?.hangup()} title={labels.hangup}>
                <PhoneHangupIcon size={16} />
              </DarkIconButton>
            </div>

            {/* Bottom bar: in-call controls, icon-only. */}
            <div className="relative flex items-center gap-1.5 rounded-2xl bg-slate-900 p-1.5 shadow-[0_18px_44px_rgba(15,23,42,0.35)]">
              <DarkIconButton
                active={Boolean(state?.muted)}
                onClick={() => actions?.toggleMute()}
                title={state?.muted ? labels.unmute : labels.mute}
              >
                {state?.muted ? <MicOffIcon size={15} /> : <MicIcon size={15} />}
              </DarkIconButton>
              {inCall ? (
                <DarkIconButton
                  active={Boolean(state?.onHold)}
                  onClick={() => actions?.toggleHold()}
                  title={state?.onHold ? labels.unhold : labels.hold}
                >
                  <HoldIcon size={15} />
                </DarkIconButton>
              ) : null}
              <DarkIconButton
                active={dialPadOpen}
                onClick={(event) => {
                  if (dialPadOpen) {
                    setDialPadOpen(false);
                  } else {
                    openDialPadAt(event?.currentTarget ?? null);
                  }
                }}
                title={labels.keypad}
              >
                <DialpadIcon size={15} />
              </DarkIconButton>
              {inCall ? (
                <DarkIconButton
                  active={transferOpen}
                  onClick={() => setTransferOpen((open) => !open)}
                  title={labels.transfer}
                >
                  <TransferIcon size={15} />
                </DarkIconButton>
              ) : null}
              <DarkIconButton
                active={!state?.speakerEnabled}
                onClick={() => actions?.toggleSpeaker()}
                title={state?.speakerEnabled ? labels.speaker : labels.speakerMuted}
              >
                {state?.speakerEnabled ? <VolumeIcon size={15} /> : <VolumeOffIcon size={15} />}
              </DarkIconButton>
              {pip.supported ? (
                <DarkIconButton onClick={() => void pip.openPip()} title={labels.pictureInPicture}>
                  <PipIcon size={15} />
                </DarkIconButton>
              ) : null}
              <span
                aria-hidden="true"
                className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-slate-900"
              />
            </div>
          </div>
        ) : (
          <div className="relative flex items-center gap-1.5 rounded-2xl bg-slate-900 p-1.5 shadow-[0_18px_44px_rgba(15,23,42,0.35)]">
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-white/10"
            >
              <span
                className={`h-2 w-2 rounded-full ${state?.registered ? "bg-emerald-500" : "bg-slate-500"}`}
              />
              {expanded ? registrationLabel : <PhoneIcon size={15} />}
            </button>
            {expanded ? (
              <>
                <DarkIconButton
                  active={dialPadOpen}
                  onClick={(event) => {
                    if (dialPadOpen) {
                      setDialPadOpen(false);
                    } else {
                      openDialPadAt(event?.currentTarget ?? null);
                    }
                  }}
                  title={labels.keypad}
                >
                  <DialpadIcon size={15} />
                </DarkIconButton>
                <div className="relative">
                  <DarkIconButton
                    active={settingsOpen}
                    onClick={() => setSettingsOpen((open) => !open)}
                    title={labels.settings}
                  >
                    <SettingsIcon size={15} />
                  </DarkIconButton>
                  {settingsOpen ? (
                    <AudioSettingsPanel
                      micLevel={0}
                      selectedInputId={state?.selectedInputDeviceId || ""}
                      selectedInputLabel={
                        state?.availableDevices.inputs.find(
                          (d) => d.deviceId === state?.selectedInputDeviceId
                        )?.label || labels.micDevice
                      }
                      inputDeviceOptions={state?.availableDevices.inputs || []}
                      selectedOutputId={state?.selectedOutputDeviceId || ""}
                      selectedOutputLabel={
                        state?.availableDevices.outputs.find(
                          (d) => d.deviceId === state?.selectedOutputDeviceId
                        )?.label || labels.speakerDevice
                      }
                      outputDeviceOptions={state?.availableDevices.outputs || []}
                      outputSelectionSupported={Boolean(state?.outputSelectionSupported)}
                      outputSelectionLocked={false}
                      deviceSelecting={deviceSelecting}
                      audioDeviceMenu={audioDeviceMenu}
                      audioSetupError={null}
                      deviceError={state?.deviceError}
                      speakerTestPlaying={speakerTestPlaying}
                      onInputDeviceSelect={handleDeviceSelect("input")}
                      onOutputDeviceSelect={handleDeviceSelect("output")}
                      onSpeakerTest={() => {
                        setSpeakerTestPlaying(true);
                        window.setTimeout(() => setSpeakerTestPlaying(false), 900);
                      }}
                      noiseSuppressionEnabled={state?.noiseSuppressionEnabled}
                      noiseSuppressionAvailable={state?.noiseSuppressionAvailable}
                      onNoiseSuppressionChange={actions?.setNoiseSuppression}
                      onAudioDeviceMenuToggle={(kind) =>
                        setAudioDeviceMenu((open) => (open === kind ? null : kind))
                      }
                      onAudioDeviceMenuClose={() => setAudioDeviceMenu(null)}
                      labels={labelsOverride}
                    />
                  ) : null}
                </div>
                {pip.supported ? (
                  <DarkIconButton onClick={() => void pip.openPip()} title={labels.pictureInPicture}>
                    <PipIcon size={15} />
                  </DarkIconButton>
                ) : null}
              </>
            ) : null}
            <span
              aria-hidden="true"
              className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full ring-2 ring-slate-900 ${state?.registered ? "bg-emerald-500" : "bg-slate-500"}`}
            />
          </div>
        )}
      </div>

      {dialPadOpen ? (
        <DialPad
          top={dialPadCoords.top}
          left={dialPadCoords.left}
          dialInput={dialInput}
          inCallMode={inCall}
          onInputChange={setDialInput}
          onClearInput={() => setDialInput("")}
          onBackspace={() => setDialInput((v) => v.slice(0, -1))}
          onDigit={(digit) => {
            if (inCall) {
              setDialInput((v) => v + digit);
              actions?.sendDtmf(digit);
            } else {
              setDialInput((v) => v + digit);
            }
          }}
          onCall={handleCall}
          onClose={() => setDialPadOpen(false)}
          labels={labelsOverride}
        />
      ) : null}

      {transferOpen ? (
        <TransferPad
          transferInput={transferInput}
          transferLoading={transferLoading}
          selectedTransferTarget={selectedTransferTarget}
          onInputChange={setTransferInput}
          onClearInput={() => setTransferInput("")}
          onDigit={(digit) => setTransferInput((v) => v + digit)}
          onTransfer={() => void handleTransfer()}
          onClose={() => setTransferOpen(false)}
          candidates={transferCandidates}
          candidatesLoading={transferCandidatesLoading}
          onSearch={onTransferSearch}
          onSelectCandidate={setSelectedTransferTarget}
          labels={labelsOverride}
        />
      ) : null}

      {state && state.wrapUpRemainingSeconds > 0
        ? createPortal(
            // .twp-root ancestor required for the "fixed"/"bottom-4"/etc.
            // utilities on this wrapper to actually apply - see
            // DraggablePill.tsx's comment. (WrapUpCard's own twp-root only
            // scopes *its own* classes, not this portal wrapper's.)
            <div className="twp-root">
              <div className="fixed bottom-4 right-4 z-[22001]">
                <WrapUpCard
                  remainingSeconds={state.wrapUpRemainingSeconds}
                  totalSeconds={state.wrapUpTotalSeconds}
                  extensionsLeft={state.wrapUpExtensionsLeft}
                  onSkip={() => actions?.skipWrapUp()}
                  onExtend={() => actions?.extendWrapUp()}
                  labels={labelsOverride}
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </DraggablePill>
  );
}
