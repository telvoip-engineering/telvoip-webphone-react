"use client";

// Small, dependency-free icon set - simple stroke-based line icons (24x24
// viewBox, consistent 2px stroke) rather than pulling in an icon library
// (e.g. @iconify/react, which the source app uses but which adds real
// bundle weight and, depending on configuration, can fetch icon data over
// the network). Every icon this package's UI needs, nothing more.

export interface IconProps {
  size?: number;
  className?: string;
}

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const PhoneIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base}>
    <path d="M4 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L14 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 2 6a2 2 0 0 1 2-2Z" />
  </svg>
);

export const PhoneHangupIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base}>
    <path d="M22 17.5c0 1-2.5 3.5-3.5 3.5C12 21 3 12 3 5.5 3 4.5 5.5 2 6.5 2 7 2 9 5 9 6c0 1-2 2-2 3s2.5 5.5 4 7 5 4 6 4 2-2 3-2 4 2 4 2.5Z" />
  </svg>
);

export const MicIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
  </svg>
);

export const MicOffIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base}>
    <path d="M3 3l18 18" />
    <path d="M9 9v2a3 3 0 0 0 4.6 2.55M15 5.5V6a3 3 0 0 0-4.7-2.47" />
    <path d="M5 11a7 7 0 0 0 10.6 6M18.9 12.5A7 7 0 0 0 19 11" />
    <path d="M12 18v4M8 22h8" />
  </svg>
);

export const HoldIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base}>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

export const DialpadIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base} fill="currentColor" stroke="none">
    {[5, 12, 19].flatMap((cy) =>
      [5, 12, 19].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.6} />)
    )}
  </svg>
);

export const ChevronDownIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const CheckIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export const CloseIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

export const SpinnerIcon = ({ size = 16, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
  >
    <path d="M12 2a10 10 0 0 1 10 10" opacity={0.85} />
  </svg>
);

export const SettingsIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);

export const VolumeIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base}>
    <path d="M4 9v6h4l5 5V4L8 9H4Z" />
    <path d="M17.5 8.5a5 5 0 0 1 0 7M20 6a9 9 0 0 1 0 12" />
  </svg>
);

export const VolumeOffIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base}>
    <path d="M4 9v6h4l5 5V4L8 9H4Z" />
    <path d="M17 9l5 5M22 9l-5 5" />
  </svg>
);

export const TransferIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base}>
    <path d="M4 7h13l-3-3M20 17H7l3 3" />
  </svg>
);

export const BackspaceIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base}>
    <path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7 6-7Z" />
    <path d="M14 10l-4 4M10 10l4 4" />
  </svg>
);

export const SearchIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

export const SaveIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
    <path d="M17 21v-8H7v8M7 3v5h8" />
  </svg>
);

export const SignalIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="currentColor">
    <rect x="3" y="14" width="4" height="7" rx="1" />
    <rect x="10" y="9" width="4" height="12" rx="1" />
    <rect x="17" y="3" width="4" height="18" rx="1" />
  </svg>
);

export const PipIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <rect x="12" y="12" width="7" height="6" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

export const BellIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} {...base} fill="currentColor" stroke="none">
    <path d="M12 2a6 6 0 0 0-6 6v3.2c0 .6-.2 1.2-.6 1.7L4 15h16l-1.4-2.1a2.8 2.8 0 0 1-.6-1.7V8a6 6 0 0 0-6-6Z" />
    <path d="M9.5 18a2.5 2.5 0 0 0 5 0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
  </svg>
);

export const DragHandleIcon = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="currentColor">
    {[7, 12, 17].flatMap((cx) => [8, 16].map((cy) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.5} />))}
  </svg>
);
