"use client";

import { UtensilsCrossed, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ResolvedScene, Timeline as TimelineData } from "@/lib/ad-plan";
import { InfoButton } from "./InfoButton";
import { cx, sceneLabel } from "./shared";

/** Shortest section the range handles allow, in seconds. */
const MIN_RANGE = 0.5;
/** Room a ruler label ("00:00" plus padding) needs, in pixels. */
const LABEL_PX = 52;
const TICK_STEPS = [1, 2, 3, 5, 10, 15, 30, 60];

/**
 * Editor timeline: a full-width ruler and track. Every clip is a scene; clicking one
 * selects that scene. Clicking the ruler or an empty spot moves the playhead. Two
 * handles on the track pick the section of the ad the assistant should edit.
 */
export function Timeline({
  scenes,
  timeline,
  selectedId,
  currentTime,
  range,
  onSelect,
  onSeek,
  onRange,
}: {
  scenes: ResolvedScene[];
  timeline: TimelineData;
  selectedId: string | null;
  currentTime: number;
  /** Selected section as [start, end] seconds. */
  range: [number, number];
  onSelect: (sceneId: string) => void;
  onSeek: (t: number) => void;
  /** null resets the selection to the whole ad. */
  onRange: (range: [number, number] | null) => void;
}) {
  const total = timeline.total || 1;
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Space labels so they never collide, and drop any too close to the end to fit.
  const pxPerSec = width / total;
  const step = width ? (TICK_STEPS.find((s) => s * pxPerSec >= LABEL_PX) ?? 60) : total > 90 ? 15 : total > 30 ? 5 : 3;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step).filter((t) => t === 0 || (total - t) * pxPerSec >= LABEL_PX);
  const pct = (t: number) => `${(Math.min(t, total) / total) * 100}%`;
  const [start, end] = range;
  const whole = start <= 0.01 && end >= total - 0.01;

  const seekFrom = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total);
  };

  /** Move one end of the range, keeping the other end fixed. */
  const setEdge = (edge: 0 | 1, t: number) => {
    const next: [number, number] = edge === 0 ? [Math.max(0, Math.min(t, end - MIN_RANGE)), end] : [start, Math.min(total, Math.max(t, start + MIN_RANGE))];
    onRange(next);
    onSeek(next[edge]);
  };

  const drag = (edge: 0 | 1) => (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = track.current!.getBoundingClientRect();
      setEdge(edge, Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * total);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const inRange = scenes.filter((_, i) => timeline.starts[i] < end && timeline.starts[i] + timeline.durations[i] > start);

  return (
    <section className="shrink-0 border-t border-white/[0.06] bg-[#0c0c0e] px-2 pb-2 sm:px-3 lg:pb-4">
      <div className="flex gap-1.5">
        <div className="flex h-7 shrink-0 items-center">
          <InfoButton
            label="About the timeline"
            side="top"
            items={[{ title: "Section slider", text: "Drag the handles to pick part of the ad, and Plate Studio will only edit that section." }]}
          />
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="relative h-7 cursor-pointer" onClick={seekFrom}>
            {ticks.map((t) => (
              <span key={t} className="absolute top-1.5 pl-2 font-mono text-[11px] text-zinc-500 tabular-nums" style={{ left: pct(t) }}>
                {clock(t)}
              </span>
            ))}
          </div>

          <div ref={track} onClick={seekFrom} className="relative h-14 cursor-pointer">
            {scenes.map((s, i) => (
              <button
                key={s.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(s.id);
                }}
                title={sceneLabel(s.kind, s.dishNumber, s.headline)}
                className={cx(
                  "absolute inset-y-1 flex min-w-0 items-center overflow-hidden rounded-md bg-zinc-800 px-2 text-left text-xs font-medium whitespace-nowrap text-white transition",
                  s.id === selectedId ? "z-10 ring-2 ring-white" : "hover:brightness-110",
                )}
                style={{ left: `calc(${pct(timeline.starts[i])} + 1px)`, width: `calc(${pct(timeline.durations[i])} - 2px)` }}
              >
                {s.imageUrl && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.imageUrl} alt="" referrerPolicy="no-referrer" className={cx("absolute inset-0 size-full object-cover", s.kind !== "dish" && "opacity-50")} />
                    <span className="absolute inset-0 bg-gradient-to-r from-black/70 to-black/10" />
                  </>
                )}
                <span className="relative truncate">
                  {!s.imageUrl && <UtensilsCrossed className="mr-1.5 inline size-3.5 text-zinc-500" />}
                  {s.kind === "dish" ? s.headline || "Untitled dish" : s.kind === "intro" ? "Intro" : "End card"}
                </span>
              </button>
            ))}

            {/* Range selection: dim what's outside it, frame what's inside */}
            <div className="pointer-events-none absolute inset-y-0 left-0 z-20 rounded-l-md bg-black/65" style={{ width: pct(start) }} />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-20 rounded-r-md bg-black/65" style={{ width: `calc(100% - ${pct(end)})` }} />
            <div className="pointer-events-none absolute inset-y-0 z-20 accent-ring rounded-md inset-ring-2 inset-ring-brand-700" style={{ left: pct(start), width: pct(end - start) }} />
            <RangeHandle edge={0} at={pct(start)} value={start} min={0} max={end - MIN_RANGE} onPointerDown={drag(0)} onStep={(d) => setEdge(0, start + d)} />
            <RangeHandle edge={1} at={pct(end)} value={end} min={start + MIN_RANGE} max={total} onPointerDown={drag(1)} onStep={(d) => setEdge(1, end + d)} />
          </div>

          {/* Playhead spans the ruler and the track */}
          <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-white" style={{ left: pct(currentTime) }}>
            <span className="absolute -top-0.5 -left-[5px] size-[11px] rounded-full bg-white" />
          </div>
        </div>
      </div>
      {!whole && (
        <div className="flex items-center gap-2 pt-1.5 text-[11px] text-zinc-500">
          <span className="min-w-0 truncate">
            <span className="accent-text font-mono text-brand-400 tabular-nums">
              {clock(start)}–{clock(end)}
            </span>{" "}
            · Plate Studio will edit {inRange.map((s) => (s.kind === "dish" ? s.headline || "Untitled dish" : s.kind === "intro" ? "the intro" : "the end card")).join(", ")}
          </span>
          <button onClick={() => onRange(null)} className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-zinc-400 transition hover:bg-white/[0.06] hover:text-white">
            <X className="size-3" /> Clear
          </button>
        </div>
      )}
    </section>
  );
}

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function RangeHandle({
  edge,
  at,
  value,
  min,
  max,
  onPointerDown,
  onStep,
}: {
  edge: 0 | 1;
  at: string;
  value: number;
  min: number;
  max: number;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onStep: (delta: number) => void;
}) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={edge === 0 ? "Section start" : "Section end"}
      aria-valuemin={Math.round(min * 10) / 10}
      aria-valuemax={Math.round(max * 10) / 10}
      aria-valuenow={Math.round(value * 10) / 10}
      aria-valuetext={clock(value)}
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        const d = e.key === "ArrowLeft" ? -0.5 : e.key === "ArrowRight" ? 0.5 : 0;
        if (!d) return;
        e.preventDefault();
        onStep(e.shiftKey ? d * 4 : d);
      }}
      className={cx(
        "accent-fill absolute inset-y-0 z-20 flex w-3 cursor-ew-resize touch-none items-center justify-center bg-brand-700 outline-none focus-visible:ring-2 focus-visible:ring-white",
        edge === 0 ? "rounded-l-md" : "-translate-x-full rounded-r-md",
      )}
      style={{ left: at }}
    >
      <span className="h-5 w-0.5 rounded-full bg-brand-200/60" />
    </div>
  );
}
