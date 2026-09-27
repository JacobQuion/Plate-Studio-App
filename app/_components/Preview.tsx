"use client";

import { ImagePlus, Loader2, MapPin, Maximize2, Minimize2, Sparkles, Square, Volume2 } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import type { ResolvedScene } from "@/lib/ad-plan";
import type { GenerateDoneEvent } from "@/lib/types";
import { RenderingOverlay } from "./RenderingOverlay";
import { cx, type GenState } from "./shared";

/**
 * The 16:9 preview. Two modes:
 *   - video: the last render
 *   - frame: an HTML mock of the selected scene, used before the first render and
 *            whenever there are edits the video doesn't show yet. It can play the
 *            scene's voiceover line (recorded on demand by /api/voice-preview).
 */

/** Seconds into the render to show before playback: past the fade-in, with the intro title up. */
const POSTER_TIME = 1.2;

export const Preview = forwardRef<
  HTMLVideoElement,
  {
    scene: ResolvedScene | null;
    rendering: boolean;
    gen: GenState;
    result: GenerateDoneEvent | null;
    showVideo: boolean;
    busy: boolean;
    onVideoClick: () => void;
    onTime: (t: number) => void;
    onAddFiles: (files: File[]) => void;
    onLink: () => void;
    /** Sample projects offered on the empty stage. */
    samples: { id: string; label: string }[];
    onSample: (id: string) => void;
  }
>(function Preview({ scene, rendering, gen, result, showVideo, busy, onVideoClick, onTime, onAddFiles, onLink, samples, onSample }, videoRef) {
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
          <SceneFrame scene={scene} />
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
              <button onClick={onLink} className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200">
                <MapPin className="size-4" /> Yelp/Google Maps
              </button>
              <button onClick={() => fileInput.current?.click()} className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200">
                <ImagePlus className="size-4" /> Upload dish photos
              </button>
            </div>
            <div className="flex max-w-xl flex-wrap items-center justify-center gap-1.5">
              <span className="mr-0.5 inline-flex items-center gap-1.5 text-sm text-zinc-500">
                <Sparkles className="size-3.5" /> Try a sample:
              </span>
              {samples.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onSample(s.id)}
                  disabled={busy}
                  className="h-7 rounded-full px-2.5 text-[13px] text-zinc-400 ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {!videoMode && scene?.voice.trim() && gen.phase !== "running" && <VoiceButton text={scene.voice.trim()} />}
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
// Voiceover preview for the HTML mock
// ---------------------------------------------------------------------------

/** Recorded lines by text, so replaying a scene doesn't record it again. */
const voiceClips = new Map<string, Promise<string>>();

function voiceClip(text: string): Promise<string> {
  let clip = voiceClips.get(text);
  if (!clip) {
    clip = fetch("/api/voice-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error || "Couldn't play the voiceover");
      return URL.createObjectURL(await res.blob());
    });
    clip.catch(() => voiceClips.delete(text));
    voiceClips.set(text, clip);
  }
  return clip;
}

function VoiceButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const request = useRef(0);

  const stop = () => {
    request.current++;
    audio.current?.pause();
    audio.current = null;
    setState("idle");
  };
  // Stop when the scene (or its line) changes, and on unmount.
  useEffect(() => {
    setError(null);
    return stop;
  }, [text]);

  const play = async () => {
    const id = ++request.current;
    setError(null);
    setState("loading");
    try {
      const url = await voiceClip(text);
      if (id !== request.current) return;
      const a = new Audio(url);
      a.onended = () => id === request.current && setState("idle");
      audio.current = a;
      await a.play();
      setState("playing");
    } catch (err) {
      if (id !== request.current) return;
      setError((err as Error).message);
      setState("idle");
    }
  };

  const label = state === "idle" ? "Play voiceover" : "Stop voiceover";
  return (
    <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2">
      <button
        onClick={() => (state === "idle" ? void play() : stop())}
        aria-label={label}
        title={label}
        className="flex h-9 items-center gap-1.5 rounded-lg bg-black/50 px-2.5 text-sm text-white/80 ring-1 ring-white/15 backdrop-blur-md transition hover:bg-black/70 hover:text-white"
      >
        {state === "loading" ? <Loader2 className="size-4 animate-spin" /> : state === "playing" ? <Square className="size-3.5 fill-current" /> : <Volume2 className="size-4" />}
        <span>{state === "playing" ? "Stop" : "Voiceover"}</span>
      </button>
      {error && <span className="rounded-md bg-black/60 px-2 py-1 text-xs text-rose-300">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HTML mock of one scene (sizes mirror lib/overlays.ts at 1920px = 100cqw)
// ---------------------------------------------------------------------------

function SceneFrame({ scene }: { scene: ResolvedScene }) {
  const img = scene.imageUrl;

  return (
    <div className="absolute inset-0">
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
            <span className="block leading-[1.02] font-black tracking-tight text-white uppercase" style={{ fontSize: scene.headline.length > 22 ? "5.7cqw" : scene.headline.length > 14 ? "7.1cqw" : "8.3cqw" }}>
              {scene.headline}
            </span>
          </div>
          <span className="mt-[2cqw] h-[0.4cqw] w-[6cqw] rounded-full bg-gradient-to-r from-orange-400 to-rose-600" />
        </div>
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
    </div>
  );
}
