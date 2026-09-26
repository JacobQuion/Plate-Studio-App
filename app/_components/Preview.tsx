"use client";

import { ImagePlus, MapPin, LoaderCircle, Maximize2, Minimize2, Sparkles } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import type { ResolvedScene } from "@/lib/ad-plan";
import type { GenerateDoneEvent } from "@/lib/types";
import { cx } from "./shared";

/**
 * The 16:9 preview. Two modes:
 *   - video: the last render
 *   - frame: an HTML mock of the selected scene, used before the first render and
 *            whenever there are edits the video doesn't show yet
 */

export const Preview = forwardRef<
  HTMLVideoElement,
  {
    scene: ResolvedScene | null;
    rendering: boolean;
    result: GenerateDoneEvent | null;
    showVideo: boolean;
    busy: boolean;
    onVideoClick: () => void;
    onTime: (t: number) => void;
    onAddFiles: (files: File[]) => void;
    onLink: () => void;
    onSample: () => void;
  }
>(function Preview({ scene, rendering, result, showVideo, busy, onVideoClick, onTime, onAddFiles, onLink, onSample }, videoRef) {
  const videoMode = !!result && showVideo && !rendering;
  const fileInput = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === stage.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen().catch(() => {});
  };

  return (
    // Fit the largest 16:9 frame into whatever space the page gives us (the whole screen when fullscreen).
    <div ref={stage} className="flex size-full items-center justify-center [&:fullscreen]:bg-black" style={{ containerType: "size" }}>
      <div
        className="relative aspect-video overflow-hidden rounded-xl bg-black shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/[0.08]"
        style={{ width: "min(100cqw, calc(100cqh * 16 / 9))", containerType: "inline-size" }}
      >
        {videoMode ? (
          <video
            key={result.videoUrl}
            ref={videoRef}
            src={result.videoUrl}
            controls
            playsInline
            onClick={onVideoClick}
            onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
            onSeeked={(e) => onTime(e.currentTarget.currentTime)}
            className="absolute inset-0 size-full bg-black object-contain"
          />
        ) : scene ? (
          <SceneFrame scene={scene} rendering={rendering} />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-zinc-900 to-black p-6 text-center">
            <div>
              <p className="font-display text-xl font-bold text-white sm:text-2xl">Let&apos;s make your ad.</p>
              <p className="mt-1 text-sm text-zinc-400">Start with photos of your food or your restaurant&apos;s page.</p>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                onAddFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap justify-center gap-2">
              <button onClick={() => fileInput.current?.click()} className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200">
                <ImagePlus className="size-4" /> Upload dish photos
              </button>
              <button onClick={onLink} className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200">
                <MapPin className="size-4" /> Yelp/Google Maps
              </button>
            </div>
            <button onClick={onSample} disabled={busy} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition hover:text-brand-400 disabled:opacity-40">
              <Sparkles className="size-3.5" /> Try sample.
            </button>
          </div>
        )}
        {/* The video's own controls already have a fullscreen button in this corner. */}
        {!videoMode && (
          <button
            onClick={toggleFullscreen}
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            title={fullscreen ? "Exit full screen" : "Full screen"}
            className="absolute right-3 bottom-3 z-20 flex size-9 items-center justify-center rounded-lg bg-black/50 text-white/80 ring-1 ring-white/15 backdrop-blur-md transition hover:bg-black/70 hover:text-white"
          >
            {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// HTML mock of one scene (sizes mirror lib/overlays.ts at 1920px = 100cqw)
// ---------------------------------------------------------------------------

function SceneFrame({ scene, rendering }: { scene: ResolvedScene; rendering: boolean }) {
  const img = scene.imageUrl;

  return (
    <div className="absolute inset-0">
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={img}
          alt=""
          referrerPolicy="no-referrer"
          className={cx("absolute inset-0 size-full object-cover", scene.kind === "outro" && "scale-110 blur-xl", rendering && "animate-kenburns")}
        />
      )}

      {scene.kind === "intro" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/45 text-center">
          {scene.subline && (
            <div className="px-2 font-bold tracking-[0.28em] text-orange-300 uppercase" >
              <span style={{ fontSize: "1.9cqw" }}>{scene.subline}</span>
            </div>
          )}
          <div className="mt-[1cqw] max-w-[80%] px-2 text-center">
            <span className="block leading-[1.02] font-black tracking-tight text-white uppercase" style={{ fontSize: scene.headline.length > 22 ? "5.7cqw" : scene.headline.length > 14 ? "7.1cqw" : "8.3cqw" }}>
              {scene.headline}
            </span>
          </div>
          <span className="mt-[2cqw] h-[0.4cqw] w-[6cqw] rounded-full bg-gradient-to-r from-orange-400 to-rose-600" />
        </div>
      )}

      {scene.kind === "dish" && (
        <>
          <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
          <div className="absolute left-[5.7cqw] max-w-[62%]" style={{ bottom: "16.7%" }}>
            <div className="block">
              <span className="line-clamp-2 block leading-[1.02] font-black tracking-tight text-white uppercase" style={{ fontSize: scene.headline.length > 34 ? "4.4cqw" : scene.headline.length > 20 ? "5.2cqw" : "6.1cqw" }}>
                {scene.headline}
              </span>
            </div>
          </div>
          <div className="absolute left-[5.7cqw] max-w-[55%]" style={{ top: `${(930 / 1080) * 100}%` }}>
            <div className="block border-l-[0.3cqw] border-orange-500 pl-[1.4cqw]">
              <span className="line-clamp-2 block leading-snug text-zinc-100" style={{ fontSize: "2.1cqw" }}>
                {scene.subline || <span className="text-white/40">+ tagline</span>}
              </span>
            </div>
          </div>
        </>
      )}

      {scene.kind === "outro" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[3cqw] bg-black/50 text-center">
          <div className="max-w-[80%] px-2 text-center">
            <span className="block leading-[1.02] font-black tracking-tight text-white uppercase" style={{ fontSize: scene.headline.length > 22 ? "4.4cqw" : "5.7cqw" }}>
              {scene.headline || <span className="text-white/40">+ restaurant name</span>}
            </span>
          </div>
          <div className="rounded-full">
            <span className="inline-block rounded-full bg-white px-[1.4em] py-[0.55em] font-black tracking-wider text-zinc-900 uppercase" style={{ fontSize: "2.5cqw" }}>
              {scene.cta} →
            </span>
          </div>
          <div className="px-2">
            <span className="font-semibold tracking-wide text-orange-300" style={{ fontSize: "2.1cqw" }}>
              {scene.subline || <span className="text-white/40">+ website</span>}
            </span>
          </div>
        </div>
      )}

      {rendering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <span className="inline-flex items-center gap-2 rounded-full bg-black/70 px-3.5 py-2 text-xs font-medium text-white ring-1 ring-white/15 backdrop-blur-md">
            <LoaderCircle className="accent-text size-3.5 animate-spin text-brand-500" /> Rendering your ad
          </span>
        </div>
      )}
    </div>
  );
}
