"use client";

import { useCallback, useEffect, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { useSip } from "../../context/SipContext";
import { resolveLabels } from "../labels";
import type { DialerProps, OutboundDid } from "../types";
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
 * Flat square control shared by every dark webphone surface.
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
      ? "bg-teal-500 text-white hover:bg-teal-400"
      : appearance === "destructive"
        ? "bg-[#f0604a] text-white hover:bg-[#dd4f3a]"
        : active
          ? "bg-white/10 text-white"
          : "bg-transparent text-slate-300 hover:bg-white/[0.07] hover:text-white";
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/60 ${palette}`}
    >
      {children}
    </button>
  );
}

function SettingsModal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="twp-root">
      <div
        className="fixed inset-0 z-[22000] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Audio settings"
          className="max-h-[calc(100vh-32px)] w-full max-w-[460px] overflow-y-auto rounded-2xl"
        >
          {children}
        </section>
      </div>
    </div>,
    document.body
  );
}

/** Generic avatar circle - no photo to show, so a consistent colored initial/icon stands in for one. */
function AvatarCircle({ label, size = 36, ringActive = false }: { label: string; size?: number; ringActive?: boolean }) {
  const initial = /^[a-z]/i.test(label.trim()) ? label.trim()[0]!.toUpperCase() : null;
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-slate-700 font-bold text-white ${ringActive ? "border-2 border-teal-400" : ""}`}
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
  outboundDids,
  onOutboundDidSelect,
  outboundDidSelecting,
  className,
}: DialerProps) {
  const sip = useSip();
  const labels = resolveLabels(labelsOverride);
  const state = sip?.state;
  const actions = sip?.actions;

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
  const [microphoneTestRunning, setMicrophoneTestRunning] = useState(false);

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

  const handleOutboundDidSelect = useCallback(
    async (did: OutboundDid) => {
      if (!onOutboundDidSelect) return;
      await onOutboundDidSelect(did);
    },
    [onOutboundDidSelect]
  );

  const handleMicrophoneTest = useCallback(async () => {
    if (!actions) return;
    setMicrophoneTestRunning(true);
    try {
      await actions.startSelfTest();
    } finally {
      // The client stops its loopback test after six seconds.
      window.setTimeout(() => setMicrophoneTestRunning(false), 6_100);
    }
  }, [actions]);

  if (!sip) return null;

  const remote = hasPendingCall ? state?.pendingCallRemote : state?.remoteIdentity;
  const remoteLabel = remote?.displayName || remote?.uri || labels.unknownCaller;

  const callStatusLabel =
    callStatus === "in-call"
      ? `${labels.callInProgress} ${formatDuration(state?.duration ?? 0)}`
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
            <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-[#202831] py-2 pl-2.5 pr-2">
              <AvatarCircle label={remoteLabel} ringActive={inCall && !state?.onHold} />
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
            <div className="relative flex items-center gap-1 rounded-2xl border border-white/10 bg-[#202831] p-1.5">
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
              <DarkIconButton
                active={settingsOpen}
                onClick={() => setSettingsOpen(true)}
                title={labels.settings}
              >
                <SettingsIcon size={15} />
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
          <div className="relative flex items-center gap-1 rounded-2xl border border-white/10 bg-[#202831] p-1.5">
            <button
              type="button"
              onClick={(event) => openDialPadAt(event.currentTarget)}
              title={labels.call}
              aria-label={labels.call}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-white transition hover:bg-white/[0.07]"
            >
              <span
                className={`absolute right-1 top-1 h-2.5 w-2.5 rounded-full ring-2 ring-slate-900 ${state?.registered ? "bg-emerald-500" : "bg-slate-500"}`}
              />
              <PhoneIcon size={18} />
            </button>
            <DarkIconButton
              active={settingsOpen}
              onClick={() => setSettingsOpen(true)}
              title={labels.settings}
            >
              <SettingsIcon size={17} />
            </DarkIconButton>
            {pip.supported ? (
              <DarkIconButton onClick={() => void pip.openPip()} title={labels.pictureInPicture}>
                <PipIcon size={15} />
              </DarkIconButton>
            ) : null}
          </div>
        )}
        {settingsOpen ? (
          <SettingsModal onClose={() => setSettingsOpen(false)}>
            <AudioSettingsPanel
                      modal
                      onClose={() => setSettingsOpen(false)}
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
                        actions?.testSpeaker();
                        window.setTimeout(() => setSpeakerTestPlaying(false), 1_000);
                      }}
                      microphoneTestRunning={microphoneTestRunning}
                      onMicrophoneTest={() => void handleMicrophoneTest()}
                      outboundDids={outboundDids}
                      onOutboundDidSelect={handleOutboundDidSelect}
                      outboundDidSelecting={outboundDidSelecting}
                      noiseSuppressionEnabled={state?.noiseSuppressionEnabled}
                      noiseSuppressionAvailable={state?.noiseSuppressionAvailable}
                      onNoiseSuppressionChange={actions?.setNoiseSuppression}
                      onAudioDeviceMenuToggle={(kind) =>
                        setAudioDeviceMenu((open) => (open === kind ? null : kind))
                      }
                      onAudioDeviceMenuClose={() => setAudioDeviceMenu(null)}
                      labels={labelsOverride}
                    />
          </SettingsModal>
        ) : null}
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
