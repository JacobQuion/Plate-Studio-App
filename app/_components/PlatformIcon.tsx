import type { Platform } from "@/lib/platforms";
import { cx } from "./shared";

/** Small brand badges (lucide doesn't ship brand logos). */
export function PlatformIcon({ platform, className }: { platform: Platform; className?: string }) {
  const svg = { viewBox: "0 0 24 24", "aria-hidden": true, className: cx("size-6 shrink-0", className) } as const;
  switch (platform) {
    case "youtube":
      return (
        <svg {...svg}>
          <rect x="1" y="4.5" width="22" height="15" rx="4.5" fill="#FF0033" />
          <path d="M10 8.8v6.4l5.4-3.2z" fill="#fff" />
        </svg>
      );
    case "instagram":
      return (
        <svg {...svg}>
          <defs>
            <radialGradient id="ig-badge" cx="0.3" cy="1.05" r="1.2">
              <stop offset="0" stopColor="#FFD776" />
              <stop offset="0.3" stopColor="#F9543A" />
              <stop offset="0.65" stopColor="#D1287F" />
              <stop offset="1" stopColor="#6A3CD6" />
            </radialGradient>
          </defs>
          <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="url(#ig-badge)" />
          <rect x="6" y="6" width="12" height="12" rx="3.6" fill="none" stroke="#fff" strokeWidth="1.7" />
          <circle cx="12" cy="12" r="2.9" fill="none" stroke="#fff" strokeWidth="1.7" />
          <circle cx="15.6" cy="8.4" r="0.95" fill="#fff" />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...svg}>
          <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="#000" stroke="#ffffff26" />
          <path d="M14.3 5.5c.3 1.8 1.4 2.9 3.2 3.1v2.3a5.5 5.5 0 0 1-3.2-1v4.8a4.2 4.2 0 1 1-4.2-4.2h.4V13a1.9 1.9 0 1 0 1.5 1.8V5.5z" fill="#25F4EE" transform="translate(-0.6 -0.4)" />
          <path d="M14.3 5.5c.3 1.8 1.4 2.9 3.2 3.1v2.3a5.5 5.5 0 0 1-3.2-1v4.8a4.2 4.2 0 1 1-4.2-4.2h.4V13a1.9 1.9 0 1 0 1.5 1.8V5.5z" fill="#FE2C55" transform="translate(0.6 0.4)" />
          <path d="M14.3 5.5c.3 1.8 1.4 2.9 3.2 3.1v2.3a5.5 5.5 0 0 1-3.2-1v4.8a4.2 4.2 0 1 1-4.2-4.2h.4V13a1.9 1.9 0 1 0 1.5 1.8V5.5z" fill="#fff" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...svg}>
          <circle cx="12" cy="12" r="10.5" fill="#0866FF" />
          <path d="M13.3 22.4v-7.3h2.4l.4-2.9h-2.8v-1.8c0-.8.3-1.4 1.4-1.4h1.5V6.4a19 19 0 0 0-2.2-.1c-2.2 0-3.6 1.3-3.6 3.7v2.2H8v2.9h2.4v7.3z" fill="#fff" />
        </svg>
      );
  }
}
