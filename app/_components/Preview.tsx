"use client";

import { Clapperboard, ImagePlus, LoaderCircle, MapPin } from "lucide-react";
import { forwardRef, useRef } from "react";
import type { GenerateDoneEvent } from "@/lib/types";
import type { GenState } from "./shared";

/** The preview contains only an actual render, never a mock scene or sample video. */
export const Preview = forwardRef<HTMLVideoElement, {
  gen: GenState;
  result: GenerateDoneEvent | null;
  dishCount: number;
  busy: boolean;
  stale: boolean;
  onVideoClick: () => void;
  onTime: (t: number) => void;
  onAddFiles: (files: File[]) => void;
  onSearch: () => void;
  onRender: () => void;
}>(function Preview({ gen, result, dishCount, busy, stale, onVideoClick, onTime, onAddFiles, onSearch, onRender }, videoRef) {
  const input = useRef<HTMLInputElement>(null);
  const running = gen.phase === "running";
  const active = running ? Object.values(gen.stages).find((s) => s.status === "active") : null;
  return <div className="flex size-full items-center justify-center" style={{ containerType: "size" }}>
    <div className="relative aspect-video overflow-hidden rounded-xl bg-[#101014] ring-1 ring-white/10" style={{ width: "min(100cqw, calc(100cqh * 16 / 9))" }}>
      {running ? <div role="status" aria-live="polite" className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-gradient-to-br from-brand-900/30 via-[#101014] to-black px-8 text-center">
        <div className="relative flex size-24 items-center justify-center"><div className="absolute inset-0 animate-spin rounded-full border-2 border-brand-400/20 border-t-brand-300 motion-reduce:animate-none" /><div className="absolute inset-3 animate-pulse rounded-full bg-brand-500/15 motion-reduce:animate-none" /><Clapperboard className="relative size-8 text-brand-200" /></div>
        <div><h2 className="text-xl font-semibold text-white">Generating your video</h2><p className="mt-2 max-w-md text-sm text-zinc-400">{active?.detail || "Preparing your scenes…"}</p></div>
        <div aria-hidden className="h-1.5 w-48 overflow-hidden rounded-full bg-white/10"><div className="h-full w-1/4 animate-scan-x rounded-full bg-brand-400 motion-reduce:animate-none" /></div>
        <p className="text-xs text-zinc-500">Your finished video will appear here.</p>
      </div> : result ? <>
        <video key={result.videoUrl} ref={videoRef} src={result.videoUrl} controls playsInline preload="metadata" onClick={onVideoClick} onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)} onSeeked={(e) => onTime(e.currentTarget.currentTime)} className="absolute inset-0 size-full bg-black object-contain" />
        {stale && <span className="pointer-events-none absolute top-3 left-3 rounded-lg bg-black/80 px-3 py-1.5 text-xs text-amber-200">Previous render · render again to include your edits</span>}
      </> : <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-6 text-center">
        <Clapperboard className="size-10 text-zinc-600" />
        <div><h2 className="text-xl font-semibold text-white">{dishCount ? "Ready when you are" : "Your video starts here"}</h2><p className="mt-2 text-sm text-zinc-400">{dishCount ? `${dishCount} ${dishCount === 1 ? "dish is" : "dishes are"} selected. Click Render to generate your video.` : "Add your dish photos or find a restaurant to get started."}</p></div>
        <div className="flex flex-wrap justify-center gap-2">
          {dishCount > 0 ? <button disabled={busy} onClick={onRender} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-40"><Clapperboard className="size-4" /> Render video</button> : <>
            <button disabled={busy} onClick={() => input.current?.click()} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-40"><ImagePlus className="size-4" /> Upload dish photos</button>
            <button disabled={busy} onClick={onSearch} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-white disabled:opacity-40"><MapPin className="size-4" /> Find restaurant</button>
          </>}
        </div>
        {busy && <LoaderCircle aria-label="Preparing your workspace" className="size-4 animate-spin text-zinc-400" />}
      </div>}
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { onAddFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    </div>
  </div>;
});
