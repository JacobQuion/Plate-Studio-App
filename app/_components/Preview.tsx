"use client";

import { ImagePlus, MapPin, Maximize2, Minimize2 } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import type { ResolvedScene } from "@/lib/ad-plan";
import { DEFAULT_FONT, googleFontsCss } from "@/lib/fonts";
import type { GenerateDoneEvent } from "@/lib/types";
import { fontStack } from "./FontPicker";
import { RenderingOverlay } from "./RenderingOverlay";
import { cx, type GenState } from "./shared";

/**
 * The 16:9 preview. Two modes:
 *   - video: the last render
 *   - frame: an HTML mock of the selected scene, used before the first render and
 *            whenever there are edits the video doesn't show yet
 */

/** Seconds into the render to show before playback: past the fade-in, with the intro title up. */
const POSTER_TIME = 1.2;

export const Preview = forwardRef<
  HTMLVideoElement,
  {
    scene: ResolvedScene | null;
    /** Brand font for the restaurant name (see FontPicker). */
    font?: string;
    rendering: boolean;
    gen: GenState;
    result: GenerateDoneEvent | null;
    showVideo: boolean;
    onVideoClick: () => void;
    onTime: (t: number) => void;
    onAddFiles: (files: File[]) => void;
    onLink: () => void;
  }
>(function Preview({ scene, font, rendering, gen, result, showVideo, onVideoClick, onTime, onAddFiles, onLink }, videoRef) {
  const videoMode = !!result && showVideo && !rendering;
  const fileInput = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  // The video fades in from black, so frame 0 looks empty. Show a frame from the intro
  // (title fully in) until the user plays, then rewind so playback still starts at 0:00.
  const showingPoster = useRef(false);
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
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.currentTime === 0 && v.duration > POSTER_TIME * 2) {
                showingPoster.current = true;
                v.currentTime = POSTER_TIME;
              }
            }}
            onPlay={(e) => {
              const v = e.currentTarget;
              if (showingPoster.current && Math.abs(v.currentTime - POSTER_TIME) < 0.05) v.currentTime = 0;
              showingPoster.current = false;
            }}
            onTimeUpdate={(e) => {
              if (!showingPoster.current) onTime(e.currentTarget.currentTime);
            }}
            onSeeked={(e) => {
              const v = e.currentTarget;
              if (showingPoster.current && Math.abs(v.currentTime - POSTER_TIME) >= 0.05) showingPoster.current = false;
              if (!showingPoster.current) onTime(v.currentTime);
            }}
            className="absolute inset-0 size-full bg-black object-contain"
          />
        ) : scene ? (
          <SceneFrame scene={scene} font={font} />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-zinc-900 to-black p-6 text-center">
            <p className="font-display text-xl font-bold text-white sm:text-2xl">Let&apos;s create your ad.</p>
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
              <button onClick={onLink} className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200">
                <MapPin className="size-4" /> Yelp/Google Maps
              </button>
              <button onClick={() => fileInput.current?.click()} className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200">
                <ImagePlus className="size-4" /> Upload Media
              </button>
            </div>
          </div>
        )}
        {gen.phase === "running" && <RenderingOverlay gen={gen} imageUrl={scene?.imageUrl || null} />}
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

function SceneFrame({ scene, font }: { scene: ResolvedScene; font?: string }) {
  const img = scene.imageUrl;
  // Like the renderer: Inter in all caps, a brand font in the name's own capitalization.
  const brand = font && font !== DEFAULT_FONT ? font : null;
  const nameClass = cx("block leading-[1.02] font-black text-white", brand ? "[font-synthesis:none]" : "tracking-tight uppercase");
  const nameFont = brand ? { fontFamily: fontStack(brand), lineHeight: 1.15 } : undefined;

  return (
    <div className="absolute inset-0">
      {brand && <link rel="stylesheet" href={googleFontsCss([brand])} precedence="default" />}
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={img}
          alt=""
          referrerPolicy="no-referrer"
          className={cx("absolute inset-0 size-full object-cover", scene.kind === "outro" && "scale-110 blur-xl")}
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
            <span className={nameClass} style={{ ...nameFont, fontSize: scene.headline.length > 22 ? "5.7cqw" : scene.headline.length > 14 ? "7.1cqw" : "8.3cqw" }}>
              {scene.headline}
            </span>
          </div>
          <span className="mt-[2cqw] h-[0.4cqw] w-[6cqw] rounded-full bg-gradient-to-r from-orange-400 to-rose-600" />
        </div>
      )}

      {scene.kind === "outro" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[3cqw] bg-black/50 text-center">
          <div className="max-w-[80%] px-2 text-center">
            <span className={nameClass} style={{ ...nameFont, fontSize: scene.headline.length > 22 ? "4.4cqw" : "5.7cqw" }}>
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
    </div>
  );
}
