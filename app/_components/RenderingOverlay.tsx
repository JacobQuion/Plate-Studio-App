"use client";

import { useEffect, useState } from "react";
import type { GenState } from "./shared";
import { stepLabel, useRenderProgress } from "./useRenderProgress";

/**
 * Shown over the preview while the ad renders: the dish photo "develops" from a blurred,
 * washed-out frame into full color behind a glowing edge that sweeps across with progress,
 * steam rising off the plate, and the scene being rendered in the center.
 */
export function RenderingOverlay({ gen, imageUrl }: { gen: Extract<GenState, { phase: "running" }>; imageUrl: string | null }) {
  const progress = useRenderProgress(gen);
  const pct = useCountUp((progress?.fraction ?? 0) * 100);
  const edge = pct > 0.5 && pct < 99.5;

  return (
    <div className="absolute inset-0 z-10 overflow-hidden bg-zinc-950 motion-safe:animate-fade-in" role="status" aria-live="polite">
      {/* Photo: blurred underneath, sharp copy revealed left to right. The clip sits outside the
          zooming image so the reveal edge lines up with the glow. */}
      {imageUrl ? (
        <>
          <div className="absolute inset-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover opacity-60 blur-xl grayscale-[0.7] motion-safe:animate-kenburns" />
          </div>
          <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover motion-safe:animate-kenburns" />
          </div>
        </>
      ) : (
        <div className="accent-fill absolute inset-0 bg-gradient-to-br from-brand-800 via-zinc-900 to-black" />
      )}

      {/* Glowing edge sweeping sideways: a soft wide halo around a bright core. */}
      <div className="pointer-events-none absolute inset-y-0 transition-opacity duration-500" style={{ left: `${pct}%`, opacity: edge ? 1 : 0 }}>
        <div className="absolute inset-y-0 w-[14cqw] -translate-x-1/2 bg-gradient-to-r from-transparent via-brand-500/60 to-transparent mix-blend-screen blur-xl motion-safe:animate-glow" />
        <div className="absolute inset-y-0 w-[3cqw] -translate-x-1/2 bg-gradient-to-r from-transparent via-brand-400/70 to-transparent mix-blend-screen blur-sm" />
        <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-brand-300 shadow-[0_0_12px_3px_var(--color-brand-400),0_0_32px_8px_var(--color-brand-500)]" />
      </div>

      {/* Steam off the plate. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4">
        {[
          { left: "38%", delay: "0s", size: "16cqw" },
          { left: "50%", delay: "1.8s", size: "20cqw" },
          { left: "61%", delay: "3.5s", size: "15cqw" },
          { left: "45%", delay: "5.1s", size: "18cqw" },
        ].map((p) => (
          <span
            key={p.delay}
            className="absolute bottom-0 rounded-full bg-white/25 opacity-0 blur-2xl motion-safe:animate-steam"
            style={{ left: p.left, width: p.size, height: p.size, animationDelay: p.delay }}
          />
        ))}
      </div>

      {/* Vignette so the text reads over any photo. */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/60" />

      {/* The step in progress in the center: the scene being rendered, or the prep step before that. */}
      <div className="absolute inset-0 flex items-center justify-center px-8">
        <span
          className="text-center font-sans leading-tight font-semibold tracking-tight text-white tabular-nums [text-shadow:0_2px_16px_rgba(0,0,0,0.6)]"
          style={{ fontSize: "max(1.5rem, 6cqw)" }}
        >
          {stepLabel(gen)}
        </span>
      </div>
    </div>
  );
}

/** Eases a number toward `target` every frame, so the reveal edge glides instead of jumping. */
function useCountUp(target: number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let frame = 0;
    const step = () => {
      setValue((v) => {
        const next = v + (target - v) * 0.08;
        return Math.abs(target - next) < 0.05 ? target : next;
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}
