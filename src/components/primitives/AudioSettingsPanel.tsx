"use client";

import { useEffect, useRef, useState } from "react";
import { type DialerLabels, resolveLabels } from "../labels";
import type { IncomingRingtonePreset, WebphoneRingtoneId } from "../../core/webphoneSounds";
import DevicePicker from "./DevicePicker";
import { CheckIcon, ChevronDownIcon, MicIcon, SettingsIcon, SpinnerIcon, VolumeIcon } from "./icons";

export interface AudioSettingsPanelProps {
  micLevel: number;
  selectedInputId: string;
  selectedInputLabel: string;
  inputDeviceOptions: Array<{ deviceId: string; label: string }>;
  selectedOutputId: string;
  selectedOutputLabel: string;
  outputDeviceOptions: Array<{ deviceId: string; label: string }>;
  outputSelectionSupported: boolean;
  outputSelectionLocked: boolean;
  deviceSelecting: "input" | "output" | null;
  audioDeviceMenu: "input" | "output" | null;
  audioSetupError: string | null;
  deviceError?: string | null;
  speakerTestPlaying: boolean;
  ringtonePresets?: IncomingRingtonePreset[];
  selectedRingtoneId?: WebphoneRingtoneId;
  previewingRingtoneId?: WebphoneRingtoneId | null;
  onInputDeviceSelect: (deviceId: string | null) => Promise<void>;
  onOutputDeviceSelect: (deviceId: string | null) => Promise<void>;
  onSpeakerTest: () => void;
  onRingtoneSelect?: (id: WebphoneRingtoneId) => void;
  onRingtonePreview?: (id: WebphoneRingtoneId) => void | Promise<void>;
  noiseSuppressionEnabled?: boolean;
  noiseSuppressionAvailable?: boolean;
  noiseSuppressionBusy?: boolean;
  onNoiseSuppressionChange?: (enabled: boolean) => Promise<void>;
  onAudioDeviceMenuToggle: (kind: "input" | "output") => void;
  onAudioDeviceMenuClose: () => void;
  labels?: Partial<DialerLabels>;
}

export default function AudioSettingsPanel({
  micLevel,
  selectedInputId,
  selectedInputLabel,
  inputDeviceOptions,
  selectedOutputId,
  selectedOutputLabel,
  outputDeviceOptions,
  outputSelectionSupported,
  outputSelectionLocked,
  deviceSelecting,
  audioDeviceMenu,
  audioSetupError,
  deviceError,
  speakerTestPlaying,
  ringtonePresets = [],
  selectedRingtoneId,
  previewingRingtoneId,
  onInputDeviceSelect,
  onOutputDeviceSelect,
  onSpeakerTest,
  onRingtoneSelect,
  onRingtonePreview,
  noiseSuppressionEnabled,
  noiseSuppressionAvailable,
  noiseSuppressionBusy,
  onNoiseSuppressionChange,
  onAudioDeviceMenuToggle,
  onAudioDeviceMenuClose,
  labels: labelsOverride,
}: AudioSettingsPanelProps) {
  const labels = resolveLabels(labelsOverride);
  const selectedRingtone = ringtonePresets.find((preset) => preset.id === selectedRingtoneId);

  // Custom dropdown (same anatomy as DevicePicker) instead of a native <select>,
  // whose OS-drawn popup can't match the white option menus.
  const [ringtoneMenuOpen, setRingtoneMenuOpen] = useState(false);
  const ringtoneMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ringtoneMenuOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && ringtoneMenuRef.current?.contains(target)) return;
      setRingtoneMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [ringtoneMenuOpen]);

  return (
    <div
      data-webphone-popup="audio"
      className="twp-root absolute bottom-full left-1/2 top-auto z-[22000] mb-2 w-[420px] max-w-[calc(100vw-24px)] -translate-x-1/2 text-left sm:left-auto sm:right-0 sm:translate-x-0 md:bottom-auto md:top-full md:mb-0 md:mt-2"
    >
      <div className="overflow-visible rounded-[26px] border border-slate-200 bg-white p-3 shadow-[0_22px_56px_rgba(15,23,42,0.20)]">
        <div className="px-1 pb-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-primary">
              <SettingsIcon size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold leading-5 text-slate-950">{labels.audioSetupTitle}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
                {labels.audioSetupDescription}
              </p>
            </div>
          </div>
        </div>

        <section className="mt-2 rounded-[20px] p-3">
          <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-semibold text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <MicIcon size={14} />
              {labels.audioMicLevel}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 shadow-sm">
              {micLevel}%
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full border border-slate-200 bg-slate-100 shadow-inner">
            <div
              className={`h-full rounded-full transition-all ${
                micLevel > 70 ? "bg-secondary" : micLevel > 24 ? "bg-emerald-500" : "bg-slate-300"
              }`}
              style={{ width: `${micLevel}%` }}
            />
          </div>
        </section>

        <section className="mt-2 grid gap-2">
          <DevicePicker
            kind="input"
            title={labels.micDevice}
            icon={<MicIcon size={14} />}
            selectedDeviceId={selectedInputId}
            selectedLabel={selectedInputLabel}
            options={inputDeviceOptions}
            disabled={false}
            loading={deviceSelecting === "input"}
            open={audioDeviceMenu === "input"}
            onToggle={onAudioDeviceMenuToggle}
            onSelect={onInputDeviceSelect}
            onClose={onAudioDeviceMenuClose}
          />
          <DevicePicker
            kind="output"
            title={labels.speakerDevice}
            icon={<VolumeIcon size={14} />}
            selectedDeviceId={selectedOutputId}
            selectedLabel={selectedOutputLabel}
            options={outputDeviceOptions}
            disabled={!outputSelectionSupported || outputSelectionLocked}
            loading={deviceSelecting === "output"}
            open={audioDeviceMenu === "output"}
            onToggle={onAudioDeviceMenuToggle}
            onSelect={onOutputDeviceSelect}
            onClose={onAudioDeviceMenuClose}
          />
        </section>

        {ringtonePresets.length && selectedRingtoneId && onRingtoneSelect ? (
          <section className="mt-2 rounded-lg bg-transparent px-3 py-2.5">
            <span className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-600">
              {labels.audioRingtones}
            </span>
            <div className="flex items-center gap-2">
              <div ref={ringtoneMenuRef} className="relative min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setRingtoneMenuOpen((open) => !open)}
                  aria-haspopup="listbox"
                  aria-expanded={ringtoneMenuOpen}
                  className={`flex w-full items-center justify-between gap-1 rounded-full border bg-transparent px-3 py-1.5 text-xs font-semibold transition ${
                    ringtoneMenuOpen
                      ? "border-orange-400 text-orange-600"
                      : "border-slate-200 text-slate-600 hover:border-orange-400 hover:text-orange-600"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-left leading-5">
                    {selectedRingtone?.name || selectedRingtoneId}
                  </span>
                  <ChevronDownIcon
                    size={13}
                    className={`shrink-0 transition ${ringtoneMenuOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {ringtoneMenuOpen ? (
                  <div className="absolute left-0 right-0 top-full z-[22010] mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-[0_12px_24px_rgba(15,23,42,0.12)]">
                    {ringtonePresets.map((preset) => {
                      const selected = preset.id === selectedRingtoneId;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setRingtoneMenuOpen(false);
                            onRingtoneSelect(preset.id);
                          }}
                          className={`flex w-full items-center gap-2 bg-transparent px-3 py-1.5 text-left text-xs transition ${
                            selected
                              ? "font-semibold text-orange-600"
                              : "text-slate-700 hover:text-slate-800"
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                          {selected ? <CheckIcon size={13} className="text-orange-600" /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              {onRingtonePreview ? (
                <button
                  type="button"
                  onClick={() => void onRingtonePreview(selectedRingtoneId)}
                  disabled={Boolean(previewingRingtoneId)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-orange-400 hover:text-orange-600 disabled:cursor-wait disabled:opacity-60"
                  aria-label={labels.audioRingtonePreview}
                >
                  {previewingRingtoneId ? (
                    <SpinnerIcon size={14} className="animate-spin" />
                  ) : (
                    <VolumeIcon size={14} />
                  )}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {noiseSuppressionAvailable && onNoiseSuppressionChange ? (
          <section className="mt-2 rounded-[20px] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-slate-600">
                  {labels.audioNoiseSuppressionTitle}
                </p>
                <p className="mt-0.5 text-[10px] leading-4 text-slate-500">
                  {labels.audioNoiseSuppressionDescription}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(noiseSuppressionEnabled)}
                aria-label={labels.audioNoiseSuppressionTitle}
                onClick={() => void onNoiseSuppressionChange(!noiseSuppressionEnabled)}
                disabled={Boolean(noiseSuppressionBusy)}
                className={`relative h-5 w-9 shrink-0 rounded-full p-0.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${
                  noiseSuppressionEnabled ? "bg-secondary" : "bg-slate-200"
                } ${noiseSuppressionBusy ? "cursor-wait opacity-60" : ""}`}
              >
                <span
                  className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    noiseSuppressionEnabled ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </section>
        ) : null}

        <section className="mt-2 rounded-[20px] bg-slate-900 p-3 text-white">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-[11px] leading-4 text-white/70">
              {outputSelectionSupported
                ? labels.audioOutputFollowsSystem
                : labels.audioOutputUnsupported}
            </p>
            <button
              type="button"
              onClick={onSpeakerTest}
              disabled={speakerTestPlaying || outputSelectionLocked}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-[11px] font-bold text-white transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary disabled:cursor-wait disabled:opacity-60"
            >
              <VolumeIcon size={13} />
              {speakerTestPlaying ? labels.audioTestingSpeaker : labels.audioTestSpeaker}
            </button>
          </div>
        </section>

        {audioSetupError || deviceError ? (
          <p className="mt-2 rounded-2xl px-3 py-2 text-[11px] leading-4 text-slate-600">
            {audioSetupError || deviceError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
