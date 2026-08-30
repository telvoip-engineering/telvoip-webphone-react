"use client";

import type { ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, SpinnerIcon } from "./icons";

export interface DevicePickerProps {
  kind: "input" | "output";
  title: string;
  icon: ReactNode;
  selectedDeviceId: string;
  selectedLabel: string;
  options: Array<{ deviceId: string; label: string }>;
  disabled: boolean;
  loading: boolean;
  open: boolean;
  onToggle: (kind: "input" | "output") => void;
  onSelect: (deviceId: string | null) => Promise<void>;
  onClose: () => void;
}

const DevicePicker = ({
  kind,
  title,
  icon,
  selectedDeviceId,
  selectedLabel,
  options,
  disabled,
  loading,
  open,
  onToggle,
  onSelect,
  onClose,
}: DevicePickerProps) => (
  <div
    data-audio-device-picker={kind}
    className="relative min-w-0"
  >
    <span className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-slate-300">
      {icon}
      {title}
    </span>
    <button
      type="button"
      disabled={disabled || loading}
      onClick={() => onToggle(kind)}
      className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium transition ${
        open
          ? "border-teal-400 bg-white/10 text-white"
          : "border-white/10 bg-white/[0.04] text-slate-200 hover:border-white/20 hover:bg-white/[0.07]"
      } disabled:cursor-not-allowed disabled:border-white/5 disabled:text-slate-500`}
    >
      <span className="min-w-0 flex-1 truncate leading-5">{selectedLabel}</span>
      {loading ? (
        <SpinnerIcon size={13} className="shrink-0 animate-spin" />
      ) : (
        <ChevronDownIcon size={13} className={`shrink-0 transition ${open ? "rotate-180" : ""}`} />
      )}
    </button>
    {open && !disabled && !loading ? (
      <div className="absolute left-0 right-0 top-full z-[22010] mt-1 overflow-hidden rounded-xl border border-white/10 bg-slate-800 py-1">
        {options.map((device) => {
          const selected = device.deviceId === selectedDeviceId;
          return (
            <button
              key={`${kind}-${device.deviceId || "default"}`}
              type="button"
              onClick={() => {
                onClose();
                void onSelect(device.deviceId || null);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                selected ? "bg-teal-500/15 font-semibold text-teal-300" : "text-slate-200 hover:bg-white/[0.06]"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{device.label}</span>
              {selected ? <CheckIcon size={13} className="text-teal-300" /> : null}
            </button>
          );
        })}
      </div>
    ) : null}
  </div>
);

export default DevicePicker;
