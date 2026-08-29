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
    className="relative min-w-0 rounded-lg bg-transparent px-3 py-2.5"
  >
    <span className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-600">
      {icon}
      {title}
    </span>
    <button
      type="button"
      disabled={disabled || loading}
      onClick={() => onToggle(kind)}
      className={`flex w-full items-center justify-between gap-1 rounded-full border bg-transparent px-3 py-1.5 text-xs font-semibold transition ${
        open
          ? "border-orange-400 text-orange-600"
          : "border-slate-200 text-slate-600 hover:border-orange-400 hover:text-orange-600"
      } disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400`}
    >
      <span className="min-w-0 flex-1 truncate leading-5">{selectedLabel}</span>
      {loading ? (
        <SpinnerIcon size={13} className="shrink-0 animate-spin" />
      ) : (
        <ChevronDownIcon size={13} className={`shrink-0 transition ${open ? "rotate-180" : ""}`} />
      )}
    </button>
    {open && !disabled && !loading ? (
      <div className="absolute left-0 right-0 top-full z-[22010] mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-[0_12px_24px_rgba(15,23,42,0.12)]">
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
              className={`flex w-full items-center gap-2 bg-transparent px-3 py-1.5 text-left text-xs transition ${
                selected ? "font-semibold text-orange-600" : "text-slate-700 hover:text-slate-800"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{device.label}</span>
              {selected ? <CheckIcon size={13} className="text-orange-600" /> : null}
            </button>
          );
        })}
      </div>
    ) : null}
  </div>
);

export default DevicePicker;
