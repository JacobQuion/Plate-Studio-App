"use client";

import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "./shared";

/** Small "i" button that opens a short list of one-line explanations. */
export function InfoButton({
  label,
  items,
  side = "bottom",
  align = "start",
}: {
  /** Accessible name, e.g. "About the context panel". */
  label: string;
  items: { title: string; text: string }[];
  side?: "top" | "bottom";
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={root} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cx("inline-flex size-6 items-center justify-center rounded-full text-zinc-500 transition hover:bg-white/[0.06] hover:text-white", open && "bg-white/[0.06] text-white")}
      >
        <Info className="size-4" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className={cx(
            "absolute z-50 w-72 max-w-[calc(100vw-2rem)] space-y-2.5 rounded-xl bg-zinc-900 p-3.5 text-left shadow-2xl ring-1 ring-white/10",
            side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
            align === "start" ? "left-0" : "right-0",
          )}
        >
          {items.map((item) => (
            <p key={item.title} className="text-[13px] leading-snug font-normal text-zinc-400">
              <span className="block font-medium text-zinc-100">{item.title}</span>
              {item.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
