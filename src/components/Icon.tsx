import type { ReactNode } from "react";

/**
 * Generated SVG icon set — clean line icons used across the site in place of
 * emojis. All inherit `currentColor`, so colour is controlled via `className`.
 */
const paths: Record<string, ReactNode> = {
  // ── Event categories ──
  coffee: (
    <>
      <path d="M4 9h13v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" />
      <path d="M17 10h2.4a2.5 2.5 0 0 1 0 5H17" />
      <path d="M8 3c-.6 1 .6 1.6 0 2.6M12 3c-.6 1 .6 1.6 0 2.6" />
    </>
  ),
  wrench: (
    <path d="M15 4.5a3.6 3.6 0 0 0-4.3 4.6l-6 6a1.8 1.8 0 0 0 2.5 2.5l6-6A3.6 3.6 0 0 0 18 7.6l-2.4 2.4-1.8-.4-.4-1.8L15 4.5Z" />
  ),
  broadcast: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M6 6a8.5 8.5 0 0 0 0 12M18 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  code: <path d="M8.5 8 4.5 12l4 4M15.5 8l4 4-4 4M13.5 6l-3 12" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
    </>
  ),
  nodes: (
    <>
      <circle cx="6" cy="7" r="2" />
      <circle cx="18" cy="7" r="2" />
      <circle cx="12" cy="17" r="2" />
      <path d="M7.7 8.4 10.4 15.6M16.3 8.4 13.6 15.6M8 7h8" />
    </>
  ),
  rocket: (
    <>
      <path d="M12 3c3 1.6 5 4.6 5 8l-1.8 2H8.8L7 11c0-3.4 2-6.4 5-8Z" />
      <circle cx="12" cy="9" r="1.3" />
      <path d="M9 13.5l-2 4 3-1M15 13.5l2 4-3-1" />
    </>
  ),
  // ── Member perks ──
  ticket: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 11a2 2 0 0 0 0 2M21 11a2 2 0 0 1 0 2" />
      <path d="M14 6.5v11" strokeDasharray="2 2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.2l3 1.8" />
    </>
  ),
  sparkle: (
    <path d="M12 3l1.9 5.4L19.5 10l-5.6 1.6L12 17l-1.9-5.4L4.5 10l5.6-1.6L12 3Z" />
  ),
  book: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h5v16H6a2 2 0 0 0-2 2V5Z" />
      <path d="M20 5a2 2 0 0 0-2-2h-5v16h5a2 2 0 0 1 2 2V5Z" />
    </>
  ),
  tag: (
    <>
      <path d="M4 12.5V5a1 1 0 0 1 1-1h7.5l7 7-8.5 8.5-7-7Z" />
      <circle cx="8.5" cy="8.5" r="1.3" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4h8v4.5a4 4 0 0 1-8 0V4Z" />
      <path d="M8 5.5H5v1a3 3 0 0 0 3 3M16 5.5h3v1a3 3 0 0 1-3 3M10 12.5V15M14 12.5V15M8.5 19h7c0-2-1.2-3.2-3.5-3.2S8.5 17 8.5 19Z" />
    </>
  ),
  medal: (
    <>
      <circle cx="12" cy="14" r="5" />
      <path d="M9.5 9.6 7 3.8M14.5 9.6 17 3.8" />
      <path d="M12 12.2l.9 1.9 2 .3-1.45 1.4.34 2L12 16.9l-1.8.9.34-2L9.1 14.4l2-.3.9-1.9Z" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  "arrow-down-tray": (
    <>
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      <path d="M7 11l5 5 5-5M12 4v12" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  share: (
    <>
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </>
  ),
  "map-pin": (
    <>
      <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
};

export function Icon({
  name,
  className = "h-6 w-6",
  strokeWidth = 1.7,
}: {
  name: string;
  className?: string;
  strokeWidth?: number;
}) {
  const path = paths[name];
  if (!path) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {path}
    </svg>
  );
}
