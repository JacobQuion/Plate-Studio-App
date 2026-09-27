import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { probeDuration, runFfmpeg } from "@/lib/ffmpeg";
import { TRANSITION_SECONDS as TRANSITION, VOICE_LEAD, planTimeline, resolveScenes, type AdProject, type CameraStyle, type LibraryDish, type ResolvedScene } from "@/lib/ad-plan";
import { renderMusicBed } from "@/lib/music";
import { VIDEO_HEIGHT, VIDEO_WIDTH, renderIntroOverlay, renderOutroOverlay, type FrameBoxes } from "@/lib/overlays";
import { buildMotionPrompt, configuredVideoProvider, expectedClipSeconds, generateMotionClip } from "@/lib/providers/video";
import { RenderEstimate } from "@/lib/render-estimate";
import { fetchStockClip, stockConfigured } from "@/lib/providers/stock";
import { bitePrompt, cheersPrompt, firePrompt, kitchenPrompt, menuSetting, platingPrompt, stockQueries, type ShotKind, type StockQuery } from "@/lib/shots";
import { generateVoiceover, voiceConfigured } from "@/lib/providers/voice";
import { fetchBuffer } from "@/lib/safe-fetch";
import type { ProgressEvent, SceneTiming, StageId, StageStatus, VideoProvider, VoiceProvider } from "@/lib/types";

/**
 * Plate Studio ad pipeline: turns 1-6 dish photos into a ~30 second 16:9 ad.
 *
 *   photos ──► [assets]   download + smart-crop each to 16:9, render text layers
 *          ├─► [motion]   video API (Luma/Replicate/Veo): each dish photo animated ─┐
 *          │              plus cooking + eating shots from text prompts, or      │ run in
 *          │              stock footage (Pexels) when there's no AI or it fails  │
 *          └─► [voice]    one voiceover line per scene ──────────────────────────┘ parallel
 *              [assemble] render each scene, join with transitions, mix voice + music
 *
 * Structure of the ad:
 *   intro   fast-cut montage (kitchen on fire, then the dishes) under the restaurant name
 *   dish ×N fire → plating → the dish itself → someone taking a bite, under an
 *           animated lower third (name) and a tagline
 *   outro   end card with the call to action and website, over friends toasting
 *
 * Without any video source (or when clips fail) the gaps are filled with camera moves
 * on the dish photo (push-in, pans, close-ups).
 *
 * What goes on screen and in the voiceover comes from the ad project
 * (lib/ad-plan.ts); scene lengths come from planTimeline() using the real
 * voiceover durations. Every external call has a local fallback.
 */

export interface AdResult {
  jobId: string;
  outputPath: string;
  durationSeconds: number;
  script: string;
  timeline: SceneTiming[];
  /** Clickable text regions per scene id. */
  layout: Record<string, FrameBoxes>;
  providers: { video: VideoProvider; voice: VoiceProvider };
}

export type ProgressCallback = (event: ProgressEvent) => void;

const FPS = 30;
/** Rough length of one shot inside a dish scene. */
const SHOT_LENGTH = 4;
/** Shortest shot we'll cut an AI clip down to. */
const MIN_CLIP_SHOT = 2.2;
/** Most we'll slow an AI clip down to fill a shot before padding with camera moves. */
const MAX_SLOWMO = 1.6;
/** AI clips generated at once (the APIs queue the rest anyway). */
const MOTION_CONCURRENCY = 6;
/** Scenes rendered at once. Each FFmpeg process is already multi-threaded. */
const RENDER_CONCURRENCY = 2;

/** Stills are oversized relative to the output so camera moves stay sharp. */
const STILL_WIDTH = Math.round(VIDEO_WIDTH * 1.5);
const STILL_HEIGHT = Math.round(VIDEO_HEIGHT * 1.5);

/** Warm, filmic look: gentle contrast, amber highlights, cooler shadows, vignette and fine grain. */
const GRADE =
  "eq=contrast=1.07:saturation=1.16:brightness=0.01,colorbalance=rs=-0.02:bs=0.03:rh=0.05:gh=0.015:bh=-0.04,vignette=PI/4.5,noise=alls=5:allf=t";

/** Where jobs are written. Served back to the browser by /api/video/[id]. */
export const JOBS_ROOT = path.join(os.tmpdir(), "plate-studio");

export function jobOutputPath(jobId: string): string {
  return path.join(JOBS_ROOT, jobId, "final_video.mp4");
}

/** Dish photos are either a public URL (menu import) or a data URI (user upload). */
async function loadImage(src: string): Promise<Buffer> {
  const dataUri = /^data:image\/[a-z+.-]+;base64,/i.exec(src);
  return dataUri ? Buffer.from(src.slice(dataUri[0].length), "base64") : fetchBuffer(src);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function generateAd(project: AdProject, library: LibraryDish[], onProgress: ProgressCallback = () => {}): Promise<AdResult> {
  const scenes = resolveScenes(project, library);
  const dishes = scenes.filter((s) => s.kind === "dish");
  if (!dishes.length) throw new Error("Add at least one dish to the ad");
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : w.endsWith("h") ? "es" : "s"}`;

  // One motion job per shot: every dish photo animated by the AI (it has to be their dish), plus
  // (optionally) the cooking and eating shots, from the AI or else from stock footage.
  const provider = configuredVideoProvider();
  const stock = stockConfigured();
  type Job = { sceneId: string; kind: ShotKind; image: string | null; prompt: string; queries: StockQuery[] };
  const jobs: Job[] = provider ? dishes.map((d) => ({ sceneId: d.id, kind: "hero", image: d.imageUrl, prompt: buildMotionPrompt(d.headline), queries: [] })) : [];
  if (project.lifestyle && (provider || stock)) {
    const intro = scenes[0];
    const outro = scenes[scenes.length - 1];
    const dish = (d: ResolvedScene) => library.find((x) => x.id === d.dishId);
    // A café menu opens on a barista and ends over coffee; a restaurant on the stove and a shared meal.
    const setting = menuSetting(dishes.map((d) => ({ title: d.headline, description: dish(d)?.description ?? d.subline })));
    jobs.push(
      { sceneId: intro.id, kind: "kitchen", image: null, prompt: kitchenPrompt(setting), queries: stockQueries("kitchen", "", "", setting) },
      ...dishes.flatMap((d) => {
        const description = dish(d)?.description ?? d.subline;
        return [
          { sceneId: d.id, kind: "fire" as const, image: null, prompt: firePrompt(d.headline, description), queries: stockQueries("fire", d.headline, description) },
          { sceneId: d.id, kind: "plating" as const, image: null, prompt: platingPrompt(d.headline, description), queries: stockQueries("plating", d.headline, description) },
          { sceneId: d.id, kind: "bite" as const, image: null, prompt: bitePrompt(d.headline, description, project.restaurant.trim()), queries: stockQueries("bite", d.headline, description) },
        ];
      }),
      { sceneId: outro.id, kind: "cheers", image: null, prompt: cheersPrompt(project.restaurant.trim(), setting), queries: stockQueries("cheers", "", "", setting) },
    );
  }
  const spoken = scenes.filter((s) => s.voice.trim()).length;

  // Every progress event carries the time left, so the client can show a real progress bar.
  const estimate = new RenderEstimate({
    assets: 3,
    motion: Math.ceil(jobs.length / MOTION_CONCURRENCY) * expectedClipSeconds(provider ?? "stock"),
    voice: Math.ceil(spoken / 2) * (voiceConfigured() ? 3 : 1.5),
    assemble: Math.ceil(scenes.length / RENDER_CONCURRENCY) * 4 + 4,
  });
  const emit = (stage: StageId, status: StageStatus, detail?: string, count?: { completed: number; total: number }) => {
    estimate.update(stage, status, count?.completed, count?.total);
    onProgress({ type: "progress", stage, status, detail, ...count, etaSeconds: estimate.remaining(), etaFloorSeconds: estimate.floor() });
  };

  const jobId = randomUUID();
  const dir = path.join(JOBS_ROOT, jobId);
  await mkdir(dir, { recursive: true });

  // -------------------------------------------------------------------------
  // 1. Assets: photos cropped to 16:9, text layers rendered
  // -------------------------------------------------------------------------
  emit("assets", "active", `Preparing ${plural(dishes.length, "photo")}`);
  const stills = new Map(dishes.map((d) => [d.id, path.join(dir, `still_${d.id}.jpg`)]));
  const [, overlays] = await Promise.all([
    Promise.all(
      dishes.map(async (d) =>
        sharp(await loadImage(d.imageUrl))
          .rotate() // respect EXIF orientation from phone photos
          .resize(STILL_WIDTH, STILL_HEIGHT, { fit: "cover", position: sharp.strategy.attention })
          .jpeg({ quality: 92 })
          .toFile(stills.get(d.id)!),
      ),
    ),
    Promise.all(
      scenes.map(async (s): Promise<{ files: string[]; boxes: FrameBoxes }> => {
        if (s.kind === "intro") {
          const o = await renderIntroOverlay(dir, s.id, s.headline, s.subline);
          return { files: [o.file], boxes: o.boxes };
        }
        if (s.kind === "outro") {
          const o = await renderOutroOverlay(dir, s.id, s.headline, s.cta, s.subline);
          return { files: [o.file], boxes: o.boxes };
        }
        // Dish scenes are footage only; the voiceover names the dish.
        return { files: [], boxes: {} };
      }),
    ),
  ]);
  emit("assets", "done", `${plural(dishes.length, "photo")} cropped to 16:9, titles rendered`);

  // -------------------------------------------------------------------------
  // 2 + 3. Motion clips and voiceover lines in parallel
  // -------------------------------------------------------------------------
  const motionTask = (async (): Promise<{ provider: VideoProvider; clips: Map<string, Clip> }> => {
    const clips = new Map<string, Clip>();
    if (!jobs.length) {
      emit("motion", "fallback", "No video key; using local camera moves (add a free PEXELS_API_KEY for cooking and diner shots)");
      return { provider: "local-motion", clips };
    }
    const name = provider === "luma" ? "Luma Dream Machine" : provider === "replicate" ? "Replicate" : provider === "gemini" ? "Google Veo" : "Pexels";
    emit("motion", "active", `${provider ? "Generating" : "Finding"} ${plural(jobs.length, "clip")} with ${name}${project.lifestyle ? " (cooking, plating, eating)" : ""}`, {
      completed: 0,
      total: jobs.length,
    });
    const usedStock = new Set<number>();
    let finished = 0;
    let fromAi = 0;
    await mapLimit(jobs, MOTION_CONCURRENCY, async (job) => {
      const out = path.join(dir, `motion_${job.sceneId}_${job.kind}.mp4`);
      let file: string | null = null;
      if (provider) {
        try {
          file = (await generateMotionClip(job.image, job.prompt, out))?.path ?? null;
          if (file) fromAi++;
        } catch (err) {
          console.warn(`[motion] ${job.kind} shot for scene ${job.sceneId} failed:`, err);
        }
      }
      if (!file && stock && job.queries.length) {
        try {
          file = await fetchStockClip(job.queries, out, usedStock);
        } catch (err) {
          console.warn(`[motion] stock ${job.kind} shot for scene ${job.sceneId} failed:`, err);
        }
      }
      if (file) clips.set(clipKey(job.sceneId, job.kind), { path: file, duration: (await probeDuration(file)) ?? 5 });
      emit("motion", "active", `${++finished} of ${plural(jobs.length, "clip")} back${provider ? ` from ${name}` : ""}`, { completed: finished, total: jobs.length });
    });
    const fromStock = clips.size - fromAi;
    const summary = [fromAi && `${fromAi} AI`, fromStock && `${fromStock} stock`].filter(Boolean).join(" + ");
    if (clips.size === jobs.length) emit("motion", "done", `${summary} clips ready`);
    else emit("motion", "fallback", clips.size ? `${summary} of ${jobs.length} clips; the rest use local moves` : "Video APIs unavailable; using local camera moves");
    return { provider: fromAi ? provider! : fromStock ? "stock" : "local-motion", clips };
  })();

  const voiceTask = (async () => {
    emit("voice", "active", `Recording ${plural(spoken, "line")}${voiceConfigured() ? " with ElevenLabs" : ""}`);
    const clips = await mapLimit(scenes, 2, async (s) => {
      if (!s.voice.trim()) return null;
      const voice = await generateVoiceover(s.voice, dir, undefined, `voice_${s.id}`);
      return voice ? { ...voice, duration: (await probeDuration(voice.path)) ?? 0 } : null;
    });
    const made = clips.filter((c) => c !== null);
    const provider: VoiceProvider = !made.length ? "silent" : made.every((c) => c.provider === "elevenlabs") ? "elevenlabs" : "system-tts";
    if (provider === "elevenlabs") emit("voice", "done", `${plural(made.length, "line")} ready`);
    else if (provider === "system-tts") emit("voice", "fallback", voiceConfigured() ? "ElevenLabs unavailable; using system voice" : "Using system voice (no ElevenLabs key)");
    else emit("voice", "fallback", spoken ? "No TTS available; music only" : "No voiceover lines");
    return { provider, clips };
  })();

  const [motion, voice] = await Promise.all([motionTask, voiceTask]);

  // -------------------------------------------------------------------------
  // 4. Plan scene lengths, render scenes, then join + mix
  // -------------------------------------------------------------------------
  const timeline = planTimeline(
    scenes,
    voice.clips.map((c) => c?.duration ?? 0),
  );
  const { durations, total } = timeline;
  const scenePaths = scenes.map((s) => path.join(dir, `scene_${s.id}.mp4`));
  let rendered = 0;
  // One step per scene plus the final mix.
  emit("assemble", "active", `Rendering scene 1 of ${scenes.length}`, { completed: 0, total: scenes.length + 1 });

  await mapLimit(scenes, RENDER_CONCURRENCY, async (scene, i) => {
    const duration = durations[i];
    const files = overlays[i].files;
    let args: string[];
    const clip = (kind: ShotKind) => motion.clips.get(clipKey(scene.id, kind)) ?? null;
    if (scene.kind === "intro") {
      const dishShots = dishes.map((d) => ({ still: stills.get(d.id)!, hero: motion.clips.get(clipKey(d.id, "hero")) ?? null }));
      args = introSceneArgs({ duration, dishes: dishShots, kitchen: clip("kitchen"), overlay: files[0], out: scenePaths[i] });
    }
    else if (scene.kind === "outro") args = outroSceneArgs({ duration, still: stills.get(dishes[0].id)!, cheers: clip("cheers"), overlay: files[0], out: scenePaths[i] });
    else {
      args = dishSceneArgs({
        duration,
        dishIndex: scene.dishNumber - 1,
        camera: scene.camera,
        still: stills.get(scene.id)!,
        clips: { fire: clip("fire"), plating: clip("plating"), hero: clip("hero"), bite: clip("bite") },
        out: scenePaths[i],
      });
    }
    await runFfmpeg(args, 240_000);
    rendered++;
    emit("assemble", "active", rendered < scenes.length ? `Rendering scene ${rendered + 1} of ${scenes.length}` : "Mixing voice and music", {
      completed: rendered,
      total: scenes.length + 1,
    });
  });

  const musicPath = project.music ? await renderMusicBed(path.join(dir, "music.wav"), total) : null;
  const outputPath = jobOutputPath(jobId);
  await runFfmpeg(
    finalMixArgs({
      scenes: scenePaths,
      durations,
      transitions: scenes.map((s) => s.transition),
      total,
      voices: voice.clips.map((c) => c?.path ?? null),
      musicPath,
      outputPath,
    }),
    300_000,
  );
  emit("assemble", "done", `final_video.mp4 · ${total.toFixed(1)}s · ${scenes.length} scenes · 1920×1080`);

  return {
    jobId,
    outputPath,
    durationSeconds: total,
    script: scenes
      .map((s) => s.voice)
      .filter(Boolean)
      .join(" "),
    timeline: scenes.map((s, i) => ({ sceneId: s.id, start: timeline.starts[i], duration: durations[i] })),
    layout: Object.fromEntries(scenes.map((s, i) => [s.id, overlays[i].boxes])),
    providers: { video: motion.provider, voice: voice.provider },
  };
}

// ---------------------------------------------------------------------------
// Camera moves (zoompan on the oversized still, one output frame per input frame)
// ---------------------------------------------------------------------------

type Move = "pushIn" | "pullOut" | "panRight" | "panLeft" | "tiltUp" | "detail" | "punchIn";
const CAMERA_MOVES: Record<CameraStyle, Move[]> = {
  auto: ["pushIn", "panRight", "detail", "pullOut", "panLeft", "tiltUp"],
  push: ["pushIn", "pullOut"],
  pan: ["panRight", "tiltUp", "panLeft"],
  detail: ["detail", "pushIn", "detail", "pullOut"],
};

function moveFilter(move: Move, frames: number): string {
  const E = `(3*pow(on/${frames},2)-2*pow(on/${frames},3))`; // smoothstep ease-in-out
  const cx = "iw/2-iw/zoom/2";
  const cy = "ih/2-ih/zoom/2";
  const m: Record<Move, [z: string, x: string, y: string]> = {
    pushIn: [`1.02+0.2*${E}`, cx, cy],
    pullOut: [`1.24-0.2*${E}`, cx, cy],
    panRight: ["1.28", `(iw-iw/zoom)*${E}`, cy],
    panLeft: ["1.28", `(iw-iw/zoom)*(1-${E})`, cy],
    tiltUp: ["1.3", cx, `(ih-ih/zoom)*(1-${E})`],
    detail: [`1.75+0.1*${E}`, `${cx}+iw*0.05*(${E}-0.5)`, `${cy}+ih*0.02*(${E}-0.5)`],
    punchIn: [`1.0+0.14*(on/${frames})`, cx, cy],
  };
  const [z, x, y] = m[move];
  return `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:fps=${FPS}`;
}

/** Split `duration` into `count` shots, as frame counts that sum exactly. */
function shotFrames(duration: number, count: number): number[] {
  const total = Math.round(duration * FPS);
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? total - base * (count - 1) : base));
}

const stillInput = (file: string, duration: number) => ["-loop", "1", "-framerate", String(FPS), "-t", duration.toFixed(2), "-i", file];
const encodeArgs = (duration: number, out: string) => [
  "-t", duration.toFixed(2),
  "-r", String(FPS),
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", "16",
  "-pix_fmt", "yuv420p",
  "-an",
  out,
];

/** Overlay that fades + slides in at `start` and fades out at `end`. dx/dy = starting offset in px. */
function animatedLayer(input: string, label: string, start: number, end: number | null, from: { dx?: number; dy?: number }) {
  const fades = [`format=rgba`, `fade=in:st=${start.toFixed(2)}:d=0.5:alpha=1`];
  if (end != null) fades.push(`fade=out:st=${end.toFixed(2)}:d=0.45:alpha=1`);
  const slide = (offset = 0, speed: number) =>
    offset ? `'if(lt(t,${start.toFixed(2)}),${offset},${offset < 0 ? "min" : "max"}(0,${offset}${offset < 0 ? "+" : "-"}(t-${start.toFixed(2)})*${speed}))'` : "0";
  return {
    prep: `${input}${fades.join(",")}[${label}]`,
    pos: `x=${slide(from.dx, 150)}:y=${slide(from.dy, 90)}`,
  };
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

interface Clip {
  path: string;
  duration: number;
}

const clipKey = (sceneId: string, kind: ShotKind) => `${sceneId}:${kind}`;

/** An AI clip as one shot: cropped to 16:9, started `from` seconds in, slowed down if the shot outlasts it, then trimmed. */
function clipShot(input: string, clip: Clip, frames: number, label: string, from = 0): string {
  const start = Math.min(from, Math.max(0, clip.duration - 1));
  const usable = Math.max(0.5, clip.duration - start - 0.1);
  const stretch = frames / FPS / usable;
  return (
    `${input}scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},` +
    `${start ? `trim=start=${start.toFixed(2)},setpts=PTS-STARTPTS,` : ""}` +
    `${stretch > 1 ? `setpts=${stretch.toFixed(3)}*PTS,` : ""}fps=${FPS},trim=end_frame=${frames},setpts=PTS-STARTPTS,setsar=1${label}`
  );
}

const clipInput = (clip: Clip) => ["-stream_loop", "-1", "-i", clip.path];

function introSceneArgs({
  duration,
  dishes,
  kitchen,
  overlay,
  out,
}: {
  duration: number;
  dishes: { still: string; hero: Clip | null }[];
  kitchen: Clip | null;
  overlay: string;
  out: string;
}): string[] {
  // Fast cuts: the kitchen in action (when we have it), then a glimpse of each dish:
  // its AI clip when there is one, else a punch-in on the photo. At least 3 cuts, reusing dishes if needed.
  const cuts = Math.max(3, Math.min(5, dishes.length + (kitchen ? 1 : 0)));
  const frames = shotFrames(duration, cuts);
  const order = Array.from({ length: cuts }, (_, c) => (kitchen ? (c === 0 ? -1 : (c - 1) % dishes.length) : c % dishes.length));
  // Inputs: dish photos, the title layer, then every clip a cut uses (one input per cut, so reused clips stay independent).
  const inputs = [...dishes.flatMap((d) => stillInput(d.still, duration)), ...stillInput(overlay, duration)];
  const overlayIdx = dishes.length;
  const stillUses = dishes.map((d, s) => (d.hero ? 0 : order.filter((o) => o === s).length));
  const parts = dishes.flatMap((_, s) => (stillUses[s] ? [`[${s}:v]split=${stillUses[s]}${Array.from({ length: stillUses[s] }, (_, u) => `[i${s}_${u}]`).join("")}`] : []));
  const seen = dishes.map(() => 0);
  let nextClipInput = overlayIdx + 1;
  order.forEach((s, c) => {
    const f = frames[c];
    const clip = s < 0 ? kitchen! : dishes[s].hero;
    if (clip) {
      inputs.push(...clipInput(clip));
      // Dish glimpses start partway in, so the intro doesn't give away the dish scene's opening.
      parts.push(clipShot(`[${nextClipInput++}:v]`, clip, f, `[c${c}]`, s < 0 ? 0 : 1.5 + seen[s]++ * 1.2));
      return;
    }
    parts.push(`[i${s}_${seen[s]++}]trim=end_frame=${f},setpts=PTS-STARTPTS,${moveFilter("punchIn", f)},setsar=1[c${c}]`);
  });
  const title = animatedLayer(`[${overlayIdx}:v]`, "title", 0.35, duration - TRANSITION - 0.2, { dy: 50 });
  const filter = [
    ...parts,
    `${order.map((_, c) => `[c${c}]`).join("")}concat=n=${cuts}:v=1:a=0,${GRADE},eq=brightness=-0.16:saturation=1.1,fade=in:st=0:d=0.5[base]`,
    title.prep,
    `[base][title]overlay=${title.pos},format=yuv420p[v]`,
  ].join(";");
  return [...inputs, "-filter_complex", filter, "-map", "[v]", ...encodeArgs(duration, out)];
}

type DishClip = "fire" | "plating" | "hero" | "bite";
type DishShot = { clip: Clip } | { still: true };

function dishSceneArgs({
  duration,
  dishIndex,
  camera,
  still,
  clips,
  out,
}: {
  duration: number;
  dishIndex: number;
  camera: CameraStyle;
  still: string;
  clips: Record<DishClip, Clip | null>;
  out: string;
}): string[] {
  // Use as many AI clips as the scene has room for, most important first.
  const room = Math.max(1, Math.floor(duration / MIN_CLIP_SHOT));
  const kept = new Set((["hero", "fire", "bite", "plating"] as const).filter((k) => clips[k]).slice(0, room));
  // With two or more clips the scene is all footage; camera moves on the photo only
  // fill time the clips can't cover (even slowed down). Otherwise, the classic ~4s moves.
  const clipSeconds = [...kept].reduce((t, k) => t + clips[k]!.duration * MAX_SLOWMO, 0);
  // Without an animated hero clip (e.g. stock footage only), the dish photo still gets a shot.
  const stillShots =
    kept.size >= 2
      ? Math.max(kept.has("hero") ? 0 : 1, Math.ceil((duration - clipSeconds) / SHOT_LENGTH))
      : Math.max(2, Math.min(12, Math.round(duration / SHOT_LENGTH))) - kept.size;
  const shots = kept.size + stillShots;
  const frames = shotFrames(duration, shots);
  // Story order: fire → plating → the dish → (camera moves) → the first bite.
  const pick = (k: DishClip): DishShot[] => (kept.has(k) ? [{ clip: clips[k]! }] : []);
  const plan: DishShot[] = [...pick("fire"), ...pick("plating"), ...pick("hero"), ...Array.from({ length: stillShots }, () => ({ still: true as const })), ...pick("bite")];

  // Inputs: 0 = still, 1.. = AI clips in plan order
  const inputs = stillInput(still, duration);
  const parts: string[] = stillShots ? [`[0:v]split=${stillShots}${Array.from({ length: stillShots }, (_, j) => `[s${j}]`).join("")}`] : [];
  let nextClipInput = 1;
  let stillIndex = 0;
  plan.forEach((shot, j) => {
    const f = frames[j];
    if ("clip" in shot) {
      inputs.push(...clipInput(shot.clip));
      parts.push(clipShot(`[${nextClipInput++}:v]`, shot.clip, f, `[v${j}]`));
      return;
    }
    const moves = CAMERA_MOVES[camera];
    const move = moves[(camera === "auto" ? dishIndex * 2 + stillIndex : stillIndex) % moves.length];
    parts.push(`[s${stillIndex++}]trim=end_frame=${f},setpts=PTS-STARTPTS,${moveFilter(move, f)},setsar=1[v${j}]`);
  });
  parts.push(`${plan.map((_, j) => `[v${j}]`).join("")}concat=n=${shots}:v=1:a=0,${GRADE},format=yuv420p[v]`);
  return [...inputs, "-filter_complex", parts.join(";"), "-map", "[v]", ...encodeArgs(duration, out)];
}

function outroSceneArgs({ duration, still, cheers, overlay, out }: { duration: number; still: string; cheers: Clip | null; overlay: string; out: string }): string[] {
  const frames = Math.round(duration * FPS);
  const card = animatedLayer("[1:v]", "card", 0.4, null, { dy: 40 });
  // Friends toasting stay recognizable under a light blur; the photo fallback is blurred into a backdrop.
  const background = cheers
    ? `${clipShot("[2:v]", cheers, frames, "")},gblur=sigma=5,${GRADE},eq=brightness=-0.22[base]`
    : `[0:v]trim=end_frame=${frames},setpts=PTS-STARTPTS,${moveFilter("pullOut", frames)},setsar=1,gblur=sigma=16,${GRADE},eq=brightness=-0.2[base]`;
  const filter = [
    background,
    card.prep,
    `[base][card]overlay=${card.pos},fade=out:st=${(duration - 0.9).toFixed(2)}:d=0.9,format=yuv420p[v]`,
  ].join(";");
  return [...stillInput(still, duration), ...stillInput(overlay, duration), ...(cheers ? clipInput(cheers) : []), "-filter_complex", filter, "-map", "[v]", ...encodeArgs(duration, out)];
}

// ---------------------------------------------------------------------------
// Final join + audio mix
// ---------------------------------------------------------------------------

/**
 * Inputs: scenes (0..S-1), then one input per voice line that exists, then music.
 * Video: scenes chained with xfade, a different transition each time.
 * Audio: each line delayed to its scene's start, mixed, then the music bed is
 *        ducked under it with sidechaincompress.
 */
export function finalMixArgs({
  scenes,
  durations,
  transitions,
  total,
  voices,
  musicPath,
  outputPath,
}: {
  scenes: string[];
  durations: number[];
  /** transitions[i] = transition out of scene i. */
  transitions: ResolvedScene["transition"][];
  total: number;
  voices: (string | null)[];
  musicPath: string | null;
  outputPath: string;
}): string[] {
  const T = total.toFixed(2);
  const inputs = scenes.flatMap((s) => ["-i", s]);
  const parts: string[] = [];

  // Video
  const starts = [0];
  let prev = "[0:v]";
  for (let i = 1; i < scenes.length; i++) {
    const offset = starts[i - 1] + durations[i - 1] - TRANSITION;
    starts.push(offset);
    const label = i === scenes.length - 1 ? "[v]" : `[x${i}]`;
    parts.push(`${prev}[${i}:v]xfade=transition=${transitions[i - 1]}:duration=${TRANSITION}:offset=${offset.toFixed(3)}${label}`);
    prev = label;
  }
  if (scenes.length === 1) parts.push("[0:v]null[v]");

  // Voice lines
  let idx = scenes.length;
  const voiceLabels: string[] = [];
  voices.forEach((file, i) => {
    if (!file) return;
    inputs.push("-i", file);
    const ms = Math.round((starts[i] + VOICE_LEAD + (i === 0 ? 0.2 : 0)) * 1000);
    parts.push(`[${idx}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${ms}:all=1[vo${i}]`);
    voiceLabels.push(`[vo${i}]`);
    idx++;
  });
  const fadeOut = `afade=out:st=${(total - 1.2).toFixed(2)}:d=1.2`;
  const hasVoice = voiceLabels.length > 0;
  if (hasVoice) {
    parts.push(`${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0:duration=longest,apad,atrim=duration=${T}[voice]`);
  }

  if (musicPath) {
    inputs.push("-i", musicPath);
    const m = `[${idx}:a]volume=1.5`;
    if (hasVoice) {
      parts.push(
        `[voice]asplit=2[vmain][vkey]`,
        `${m}[music]`,
        `[music][vkey]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=450[ducked]`,
        `[vmain][ducked]amix=inputs=2:normalize=0:duration=first,${fadeOut},alimiter=limit=0.95[a]`,
      );
    } else {
      parts.push(`${m},apad,atrim=duration=${T},${fadeOut}[a]`);
    }
  } else if (hasVoice) {
    parts.push(`[voice]${fadeOut},alimiter=limit=0.95[a]`);
  } else {
    inputs.push("-f", "lavfi", "-t", T, "-i", "anullsrc=r=44100:cl=stereo");
    parts.push(`[${idx}:a]anull[a]`);
  }

  return [
    ...inputs,
    "-filter_complex", parts.join(";"),
    "-map", "[v]",
    "-map", "[a]",
    "-t", T,
    "-r", String(FPS),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    outputPath,
  ];
}
