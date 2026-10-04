"use client";

import { Check, ChevronDown, Globe } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_FONT, FONT_CHOICES, googleFontsCss, type BrandFontInfo } from "@/lib/fonts";
import { cx } from "./shared";

/** CSS for a font name in the studio: the brand font, then a matching generic fallback. */
export const fontStack = (family: string) => `"${family}", ${family === DEFAULT_FONT ? "var(--font-sans, sans-serif)" : "serif"}`;

/**
 * Picks the font the restaurant name is set in on the intro and end card.
 * "Match website" (no project.font) uses the font detected from the restaurant's site.
 */
export function FontPicker({
  value,
  resolved,
  website,
  disabled,
  onChange,
}: {
  /** project.font: undefined = match the website. */
  value?: string;
  /** What the server says the name will actually be set in. */
  resolved: BrandFontInfo | null;
  website: string;
  disabled?: boolean;
  onChange: (font: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const current = resolved?.family ?? value ?? DEFAULT_FONT;
  const autoDetail = !website.trim()
    ? "Add your website to match its font"
    : !value && resolved
      ? resolved.source === "website"
        ? `Using ${resolved.family} from your website`
        : "Couldn't read a font from your website"
      : "Uses the font on your website";

  const pick = (font: string | undefined) => {
    onChange(font);
    setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      {/* Every choice drawn in its own font; loaded only once the menu has been opened. */}
      {open && <link rel="stylesheet" href={googleFontsCss(FONT_CHOICES.filter((f) => f.family !== DEFAULT_FONT).map((f) => f.family))} precedence="default" />}
      {current !== DEFAULT_FONT && <link rel="stylesheet" href={googleFontsCss([current])} precedence="default" />}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Font for your restaurant name"
        className={cx(
          "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[14px] text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100 disabled:opacity-40",
          open && "bg-white/[0.06] text-zinc-100",
        )}
      >
        <span className="text-[17px] leading-none text-zinc-100" style={{ fontFamily: fontStack(current) }}>
          Aa
        </span>
        <span className="hidden max-w-36 truncate md:inline">{current}</span>
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <div role="listbox" aria-label="Font" className="absolute top-full left-0 z-50 mt-2 max-h-[70dvh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl bg-zinc-900 p-1.5 shadow-2xl ring-1 ring-white/10">
          <Option selected={!value} onClick={() => pick(undefined)}>
            <Globe className="size-4 shrink-0 text-zinc-500" />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] text-zinc-100">Match website</span>
              <span className="block truncate text-[12px] text-zinc-500">{autoDetail}</span>
            </span>
          </Option>
          <div className="my-1.5 h-px bg-white/[0.06]" />
          {FONT_CHOICES.map((f) => (
            <Option key={f.family} selected={value === f.family} onClick={() => pick(f.family)}>
              <span className="min-w-0 flex-1 truncate text-[18px] leading-tight text-zinc-100" style={{ fontFamily: fontStack(f.family), fontWeight: 700 }}>
                {f.family}
              </span>
              <span className="shrink-0 text-[12px] text-zinc-500">{f.style}</span>
            </Option>
          ))}
          {value && !FONT_CHOICES.some((f) => f.family === value) && (
            <Option selected onClick={() => pick(value)}>
              <span className="min-w-0 flex-1 truncate text-[18px] text-zinc-100" style={{ fontFamily: fontStack(value) }}>
                {value}
              </span>
              <span className="shrink-0 text-[12px] text-zinc-500">Custom</span>
            </Option>
          )}
        </div>
      )}
    </div>
  );
}

function Option({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={cx("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.06]", selected && "bg-white/[0.04]")}
    >
      {children}
      <Check className={cx("size-4 shrink-0 text-zinc-300", !selected && "invisible")} />
    </button>
  );
}
