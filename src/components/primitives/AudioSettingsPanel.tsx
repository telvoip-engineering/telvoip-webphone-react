"use client";

import { useEffect, useRef, useState } from "react";
import { type DialerLabels, resolveLabels } from "../labels";
import type { IncomingRingtonePreset, WebphoneRingtoneId } from "../../core/webphoneSounds";
import type { OutboundDid } from "../types";
import DevicePicker from "./DevicePicker";
import { CheckIcon, ChevronDownIcon, CloseIcon, MicIcon, SettingsIcon, SpinnerIcon, VolumeIcon } from "./icons";

export interface AudioSettingsPanelProps {
  micLevel: number;
  selectedInputId: string; selectedInputLabel: string; inputDeviceOptions: Array<{ deviceId: string; label: string }>;
  selectedOutputId: string; selectedOutputLabel: string; outputDeviceOptions: Array<{ deviceId: string; label: string }>;
  outputSelectionSupported: boolean; outputSelectionLocked: boolean; deviceSelecting: "input" | "output" | null;
  audioDeviceMenu: "input" | "output" | null; audioSetupError: string | null; deviceError?: string | null;
  speakerTestPlaying: boolean; microphoneTestRunning?: boolean; onMicrophoneTest?: () => void | Promise<void>;
  outboundDids?: OutboundDid[]; onOutboundDidSelect?: (did: OutboundDid) => void | Promise<void>; outboundDidSelecting?: boolean;
  modal?: boolean; onClose?: () => void;
  ringtonePresets?: IncomingRingtonePreset[]; selectedRingtoneId?: WebphoneRingtoneId; previewingRingtoneId?: WebphoneRingtoneId | null;
  onInputDeviceSelect: (deviceId: string | null) => Promise<void>; onOutputDeviceSelect: (deviceId: string | null) => Promise<void>;
  onSpeakerTest: () => void; onRingtoneSelect?: (id: WebphoneRingtoneId) => void; onRingtonePreview?: (id: WebphoneRingtoneId) => void | Promise<void>;
  noiseSuppressionEnabled?: boolean; noiseSuppressionAvailable?: boolean; noiseSuppressionBusy?: boolean; onNoiseSuppressionChange?: (enabled: boolean) => Promise<void>;
  onAudioDeviceMenuToggle: (kind: "input" | "output") => void; onAudioDeviceMenuClose: () => void; labels?: Partial<DialerLabels>;
}

export default function AudioSettingsPanel(props: AudioSettingsPanelProps) {
  const {
    selectedInputId, selectedInputLabel, inputDeviceOptions, selectedOutputId, selectedOutputLabel, outputDeviceOptions,
    outputSelectionSupported, outputSelectionLocked, deviceSelecting, audioDeviceMenu, audioSetupError, deviceError,
    speakerTestPlaying, microphoneTestRunning = false, onMicrophoneTest, outboundDids = [], onOutboundDidSelect,
    outboundDidSelecting = false, modal = false, onClose, ringtonePresets = [], selectedRingtoneId, previewingRingtoneId,
    onInputDeviceSelect, onOutputDeviceSelect, onSpeakerTest, onRingtoneSelect, onRingtonePreview,
    noiseSuppressionEnabled, noiseSuppressionAvailable, noiseSuppressionBusy, onNoiseSuppressionChange,
    onAudioDeviceMenuToggle, onAudioDeviceMenuClose, labels: labelsOverride,
  } = props;
  const labels = resolveLabels(labelsOverride);
  const [ringtoneMenuOpen, setRingtoneMenuOpen] = useState(false);
  const ringtoneMenuRef = useRef<HTMLDivElement | null>(null);
  const selectedRingtone = ringtonePresets.find((preset) => preset.id === selectedRingtoneId);

  useEffect(() => {
    if (!ringtoneMenuOpen) return;
    const close = (event: MouseEvent | TouchEvent) => {
      if (event.target instanceof Node && ringtoneMenuRef.current?.contains(event.target)) return;
      setRingtoneMenuOpen(false);
    };
    document.addEventListener("mousedown", close); document.addEventListener("touchstart", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("touchstart", close); };
  }, [ringtoneMenuOpen]);

  return <div className="twp-root"><div className={modal ? "w-full text-left" : "absolute bottom-full right-0 z-[22000] mb-2 w-[400px] max-w-[calc(100vw-24px)] text-left"}>
    <div className="border border-white/10 bg-[#202831] p-5 text-white">
      <header className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-500/15 text-teal-300"><SettingsIcon size={18} /></span><div><h2 className="text-sm font-semibold">{labels.audioSetupTitle}</h2><p className="mt-0.5 text-[11px] text-slate-400">{labels.audioSetupDescription}</p></div></div>
        {onClose ? <button type="button" onClick={onClose} aria-label="Close settings" className="rounded-lg p-2 text-slate-400 transition hover:bg-white/[0.07] hover:text-white"><CloseIcon size={16} /></button> : null}
      </header>
      <div className="space-y-5 pt-5">
        <section className="space-y-3"><DevicePicker kind="input" title={labels.micDevice} icon={<MicIcon size={14} />} selectedDeviceId={selectedInputId} selectedLabel={selectedInputLabel} options={inputDeviceOptions} disabled={false} loading={deviceSelecting === "input"} open={audioDeviceMenu === "input"} onToggle={onAudioDeviceMenuToggle} onSelect={onInputDeviceSelect} onClose={onAudioDeviceMenuClose} /><DevicePicker kind="output" title={labels.speakerDevice} icon={<VolumeIcon size={14} />} selectedDeviceId={selectedOutputId} selectedLabel={selectedOutputLabel} options={outputDeviceOptions} disabled={!outputSelectionSupported || outputSelectionLocked} loading={deviceSelecting === "output"} open={audioDeviceMenu === "output"} onToggle={onAudioDeviceMenuToggle} onSelect={onOutputDeviceSelect} onClose={onAudioDeviceMenuClose} /></section>
        {outboundDids.length ? <section className="border-t border-white/10 pt-4"><p className="text-[11px] font-medium text-slate-200">{labels.outboundDid}</p><p className="mt-1 text-[11px] text-slate-400">{labels.outboundDidDescription}</p><div className="mt-2 grid gap-1.5">{outboundDids.map((did) => { const selected = Boolean(did.selected); return <button key={String(did.id)} type="button" disabled={selected || outboundDidSelecting || !onOutboundDidSelect} onClick={() => void onOutboundDidSelect?.(did)} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-xs transition ${selected ? "border-teal-400/50 bg-teal-400/10 text-teal-200" : "border-white/10 bg-white/[0.03] text-slate-200 hover:bg-white/[0.07]"} disabled:cursor-default disabled:opacity-70`}><span className="min-w-0 flex-1 truncate font-medium">{did.label || did.number}</span>{did.label ? <span className="text-[10px] text-slate-400">{did.number}</span> : null}{selected ? <CheckIcon size={14} /> : outboundDidSelecting ? <SpinnerIcon size={14} className="animate-spin" /> : null}</button>; })}</div></section> : null}
        {ringtonePresets.length && selectedRingtoneId && onRingtoneSelect ? <section className="border-t border-white/10 pt-4"><p className="mb-1.5 text-[11px] font-medium text-slate-200">{labels.audioRingtones}</p><div ref={ringtoneMenuRef} className="relative"><button type="button" onClick={() => setRingtoneMenuOpen((open) => !open)} className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs text-slate-200"><span>{selectedRingtone?.name || selectedRingtoneId}</span><ChevronDownIcon size={14} /></button>{ringtoneMenuOpen ? <div className="absolute inset-x-0 top-full z-[22010] mt-1 overflow-hidden rounded-xl border border-white/10 bg-slate-800 py-1">{ringtonePresets.map((preset) => <button key={preset.id} type="button" onClick={() => { setRingtoneMenuOpen(false); onRingtoneSelect(preset.id); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-200 hover:bg-white/[0.06]"><span className="flex-1">{preset.name}</span>{preset.id === selectedRingtoneId ? <CheckIcon size={13} className="text-teal-300" /> : null}</button>)}</div> : null}</div>{onRingtonePreview ? <button type="button" onClick={() => void onRingtonePreview(selectedRingtoneId)} disabled={Boolean(previewingRingtoneId)} className="mt-2 text-[11px] text-teal-300 hover:text-teal-200">{labels.audioRingtonePreview}</button> : null}</section> : null}
        {noiseSuppressionAvailable && onNoiseSuppressionChange ? <section className="flex items-center justify-between gap-4 border-t border-white/10 pt-4"><div><p className="text-[11px] font-medium text-slate-200">{labels.audioNoiseSuppressionTitle}</p><p className="mt-1 text-[11px] text-slate-400">{labels.audioNoiseSuppressionDescription}</p></div><button type="button" role="switch" aria-checked={Boolean(noiseSuppressionEnabled)} onClick={() => void onNoiseSuppressionChange(!noiseSuppressionEnabled)} disabled={Boolean(noiseSuppressionBusy)} className={`h-6 w-10 rounded-full p-1 transition ${noiseSuppressionEnabled ? "bg-teal-500" : "bg-slate-600"}`}><span className={`block h-4 w-4 rounded-full bg-white transition-transform ${noiseSuppressionEnabled ? "translate-x-4" : "translate-x-0"}`} /></button></section> : null}
        <section className="grid grid-cols-2 gap-2 border-t border-white/10 pt-4"><button type="button" onClick={onSpeakerTest} disabled={speakerTestPlaying || outputSelectionLocked} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs font-medium text-slate-100 transition hover:bg-white/[0.08] disabled:opacity-60"><VolumeIcon size={14} />{speakerTestPlaying ? labels.audioTestingSpeaker : labels.audioTestSpeaker}</button>{onMicrophoneTest ? <button type="button" onClick={() => void onMicrophoneTest()} disabled={microphoneTestRunning} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs font-medium text-slate-100 transition hover:bg-white/[0.08] disabled:opacity-60"><MicIcon size={14} />{microphoneTestRunning ? labels.audioTestingMicrophone : labels.audioTestMicrophone}</button> : null}</section>
        {onMicrophoneTest ? <p className="text-[10px] leading-4 text-slate-500">{labels.audioMicrophoneTestHint}</p> : null}{audioSetupError || deviceError ? <p className="border border-red-400/20 bg-red-400/10 px-3 py-2 text-[11px] text-red-200">{audioSetupError || deviceError}</p> : null}
      </div>
    </div>
  </div></div>;
}
