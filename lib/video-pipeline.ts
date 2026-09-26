import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { probeDuration, runFfmpeg } from "@/lib/ffmpeg";
import { TRANSITION_SECONDS as TRANSITION, VOICE_LEAD, planTimeline, resolveScenes, type AdProject, type CameraStyle, type LibraryDish, type ResolvedScene } from "@/lib/ad-plan";
import { renderMusicBed } from "@/lib/music";
import { VIDEO_HEIGHT, VIDEO_WIDTH, renderDishOverlays, renderIntroOverlay, renderOutroOverlay, type FrameBoxes } from "@/lib/overlays";
import { buildMotionPrompt, configuredVideoProvider, generateMotionClip } from "@/lib/providers/video";
import { fetchStockClip, stockConfigured } from "@/lib/providers/stock";
import { bitePrompt, cheersPrompt, firePrompt, kitchenPrompt, menuSetting, platingPrompt, servingPrompt, socializingPrompt, stockQueries, type ShotKind, type StockQuery } from "@/lib/shots";
import { generateVoiceover, voiceConfigured } from "@/lib/providers/voice";
import { prepareDishImages } from "@/lib/image-assets";
import { clipKey, LIFESTYLE_IMAGES, planShots, type Clip, type Shot } from "@/lib/shot-plan";
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
 *   intro   a server welcomes guests, then the kitchen, under the restaurant name
 *   dish ×N fire → plating → the dish itself → someone taking a bite, under an
 *           animated lower third (name) and a tagline
 *   outro   end card over friends socializing and toasting
 *
 * Each image or clip appears once. Missing footage uses distinct bundled dining
 * images; a dish photo gets one continuous camera move, never repeated cuts.
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
  const emit = (stage: StageId, status: StageStatus, detail?: string) => onProgress({ type: "progress", stage, status, detail });
  const scenes = resolveScenes(project, library);
  const dishes = scenes.filter((s) => s.kind === "dish");
  if (!dishes.length) throw new Error("Add at least one dish to the ad");
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : w.endsWith("h") ? "es" : "s"}`;

  const jobId = randomUUID();
  const dir = path.join(JOBS_ROOT, jobId);
  await mkdir(dir, { recursive: true });

  // -------------------------------------------------------------------------
  // 1. Assets: photos cropped to 16:9, text layers rendered
  // -------------------------------------------------------------------------
  emit("assets", "active", `Preparing ${plural(dishes.length, "photo")}`);
  // Validate duplicates before making any paid motion or voice requests.
  const images = await prepareDishImages(dishes);
  const stills = new Map(dishes.map((d) => [d.id, path.join(dir, `still_${d.id}.jpg`)]));
  const fallbackStills: Partial<Record<keyof typeof LIFESTYLE_IMAGES, string>> = {};
  if (project.lifestyle) {
    for (const [name, url] of Object.entries(LIFESTYLE_IMAGES)) {
      const file = path.join(dir, `lifestyle_${name}.jpg`);
      await sharp(path.join(process.cwd(), "public", url))
        .resize(STILL_WIDTH, STILL_HEIGHT, { fit: "cover" }).jpeg({ quality: 92 }).toFile(file);
      fallbackStills[name as keyof typeof LIFESTYLE_IMAGES] = file;
    }
  }
  const [, overlays] = await Promise.all([
    Promise.all(dishes.map((d) => writeFile(stills.get(d.id)!, images.get(d.id)!))),
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
        const o = await renderDishOverlays(dir, s.id, { title: s.headline, tagline: s.subline });
        return { files: [o.title, o.tagline], boxes: o.boxes };
      }),
    ),
  ]);
  emit("assets", "done", `${plural(dishes.length, "photo")} cropped to 16:9, titles rendered`);

  // -------------------------------------------------------------------------
  // 2 + 3. Motion clips and voiceover lines in parallel
  // -------------------------------------------------------------------------
  const motionTask = (async (): Promise<{ provider: VideoProvider; clips: Map<string, Clip> }> => {
    const clips = new Map<string, Clip>();
    const provider = configuredVideoProvider();
    const stock = stockConfigured();
    // One job per shot: every dish photo animated by the AI (it has to be their dish), plus
    // (optionally) the cooking and eating shots, from the AI or else from stock footage.
    const intro = scenes[0];
    const outro = scenes[scenes.length - 1];
    type Job = { sceneId: string; kind: ShotKind; image: string | null; prompt: string; queries: StockQuery[] };
    const jobs: Job[] = provider ? dishes.map((d) => ({ sceneId: d.id, kind: "hero", image: d.imageUrl, prompt: buildMotionPrompt(d.headline), queries: [] })) : [];
    if (project.lifestyle && (provider || stock)) {
      const dish = (d: ResolvedScene) => library.find((x) => x.id === d.dishId);
      // A café menu opens on a barista and ends over coffee; a restaurant on the stove and a shared meal.
      const setting = menuSetting(dishes.map((d) => ({ title: d.headline, description: dish(d)?.description ?? d.subline })));
      jobs.push(
        { sceneId: intro.id, kind: "serving", image: null, prompt: servingPrompt(project.restaurant.trim(), setting), queries: stockQueries("serving", "", "", setting) },
        { sceneId: intro.id, kind: "kitchen", image: null, prompt: kitchenPrompt(setting), queries: stockQueries("kitchen", "", "", setting) },
        ...dishes.flatMap((d) => {
          const description = dish(d)?.description ?? d.subline;
          return [
            { sceneId: d.id, kind: "fire" as const, image: null, prompt: firePrompt(d.headline, description), queries: stockQueries("fire", d.headline, description) },
            { sceneId: d.id, kind: "plating" as const, image: null, prompt: platingPrompt(d.headline, description), queries: stockQueries("plating", d.headline, description) },
            { sceneId: d.id, kind: "bite" as const, image: null, prompt: bitePrompt(d.headline, description, project.restaurant.trim()), queries: stockQueries("bite", d.headline, description) },
          ];
        }),
        { sceneId: outro.id, kind: "socializing", image: null, prompt: socializingPrompt(project.restaurant.trim(), setting), queries: stockQueries("socializing", "", "", setting) },
        { sceneId: outro.id, kind: "cheers", image: null, prompt: cheersPrompt(project.restaurant.trim(), setting), queries: stockQueries("cheers", "", "", setting) },
      );
    }
    if (!jobs.length) {
      emit("motion", "fallback", project.lifestyle ? "Using unique dish photos and bundled dining, socializing and serving images" : "Using one continuous camera move per dish photo");
      return { provider: "local-motion", clips };
    }
    const name = provider === "luma" ? "Luma Dream Machine" : provider === "replicate" ? "Replicate" : provider === "gemini" ? "Google Veo" : "Pexels";
    emit("motion", "active", `${provider ? "Generating" : "Finding"} ${plural(jobs.length, "clip")} with ${name}${project.lifestyle ? " (eating, serving, socializing, cooking)" : ""}`);
    const usedStock = new Set<number>();
    const usedContent = new Set<string>();
    const acceptClip = async (file: string): Promise<Clip> => {
      const duration = await probeDuration(file);
      if (!duration || duration < 0.5) throw new Error("Video provider returned an unreadable clip");
      // Different provider IDs or URLs can still contain the very same media.
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      const fingerprint = hash.digest("hex");
      if (usedContent.has(fingerprint)) throw new Error("Video provider returned a repeated clip");
      usedContent.add(fingerprint);
      return { path: file, duration };
    };
    let finished = 0;
    let fromAi = 0;
    await mapLimit(jobs, MOTION_CONCURRENCY, async (job) => {
      const out = path.join(dir, `motion_${job.sceneId}_${job.kind}.mp4`);
      let accepted: Clip | null = null;
      if (provider) {
        try {
          const file = (await generateMotionClip(job.image, job.prompt, out))?.path;
          if (file) {
            accepted = await acceptClip(file);
            fromAi++;
          }
        } catch (err) {
          console.warn(`[motion] ${job.kind} shot for scene ${job.sceneId} failed:`, err);
        }
      }
      if (!accepted && stock && job.queries.length) {
        try {
          accepted = await acceptClip(await fetchStockClip(job.queries, out, usedStock));
        } catch (err) {
          console.warn(`[motion] stock ${job.kind} shot for scene ${job.sceneId} failed:`, err);
        }
      }
      if (accepted) clips.set(clipKey(job.sceneId, job.kind), accepted);
      emit("motion", "active", `${++finished} of ${plural(jobs.length, "clip")} back${provider ? ` from ${name}` : ""}`);
    });
    const fromStock = clips.size - fromAi;
    const summary = [fromAi && `${fromAi} AI`, fromStock && `${fromStock} stock`].filter(Boolean).join(" + ");
    if (clips.size === jobs.length) emit("motion", "done", `${summary} clips ready`);
    else emit("motion", "fallback", clips.size ? `${summary} clips; missing shots use unique local images` : "Video APIs unavailable; using unique local images");
    return { provider: fromAi ? provider! : fromStock ? "stock" : "local-motion", clips };
  })();

  const voiceTask = (async () => {
    const spoken = scenes.filter((s) => s.voice.trim()).length;
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
  const shots = planShots(scenes, durations, stills, motion.clips, project.lifestyle, fallbackStills);
  let rendered = 0;
  emit("assemble", "active", `Rendering scene 1 of ${scenes.length}`);

  await mapLimit(scenes, RENDER_CONCURRENCY, async (scene, i) => {
    const duration = durations[i];
    const files = overlays[i].files;
    const args = sceneArgs({ scene, duration, shots: shots[i], overlays: files, out: scenePaths[i] });
    await runFfmpeg(args, 240_000);
    rendered++;
    emit("assemble", "active", rendered < scenes.length ? `Rendering scene ${rendered + 1} of ${scenes.length}` : "Mixing voice and music");
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

/** Play each clip once. Slow it to fit; never loop back to its opening frames. */
function clipShot(input: string, clip: Clip, frames: number, label: string): string {
  const usable = Math.max(0.1, clip.duration - 0.1);
  const stretch = Math.max(1, frames / FPS / usable);
  return `${input}scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},` +
    `setpts=${stretch.toFixed(6)}*(PTS-STARTPTS),fps=${FPS},tpad=stop_mode=clone:stop_duration=0.1,` +
    `trim=end_frame=${frames},setpts=PTS-STARTPTS,setsar=1${label}`;
}

/** Shared renderer: a scene only sees the unique sources assigned by planShots. */
export function sceneArgs({ scene, duration, shots, overlays, out }: {
  scene: ResolvedScene;
  duration: number;
  shots: Shot[];
  overlays: string[];
  out: string;
}): string[] {
  const inputs: string[] = [];
  const parts: string[] = [];
  const frames = shotFrames(duration, Math.max(1, shots.length));
  shots.forEach((shot, i) => {
    if (shot.kind === "clip") {
      inputs.push("-i", shot.clip.path);
      parts.push(clipShot(`[${i}:v]`, shot.clip, frames[i], `[shot${i}]`));
    } else {
      inputs.push(...stillInput(shot.path, duration));
      const moves = CAMERA_MOVES[scene.camera];
      const move = moves[(Math.max(0, scene.dishNumber - 1) * 2 + i) % moves.length];
      parts.push(`[${i}:v]trim=end_frame=${frames[i]},setpts=PTS-STARTPTS,${moveFilter(move, frames[i])},setsar=1[shot${i}]`);
    }
  });
  // Lifestyle off: dedicated brand cards, with no dish photo recycled behind them.
  if (!shots.length) {
    inputs.push("-f", "lavfi", "-i", `color=c=${scene.kind === "intro" ? "0x21150f" : "0x101820"}:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:r=${FPS}:d=${duration}`);
    parts.push("[0:v]setsar=1[shot0]");
  }
  const count = Math.max(1, shots.length);
  const join = count === 1 ? "[shot0]null" : `${shots.map((_, i) => `[shot${i}]`).join("")}concat=n=${count}:v=1:a=0`;
  parts.push(`${join},${GRADE}${scene.kind === "dish" ? "" : ",eq=brightness=-0.18"}[base]`);
  inputs.push(...overlays.flatMap((file) => stillInput(file, duration)));
  const textOut = Math.max(0.8, duration - TRANSITION - 0.5);
  const title = animatedLayer(`[${count}:v]`, "title", 0.25, scene.kind === "outro" ? null : textOut, scene.kind === "dish" ? { dx: -60 } : { dy: 40 });
  parts.push(title.prep, `[base][title]overlay=${title.pos}[titled]`);
  let last = "[titled]";
  if (scene.kind === "dish") {
    const tagline = animatedLayer(`[${count + 1}:v]`, "tagline", Math.min(1.4, duration / 3), textOut, { dy: 30 });
    parts.push(tagline.prep, `[titled][tagline]overlay=${tagline.pos}[tagged]`);
    last = "[tagged]";
  }
  const fade = scene.kind === "intro" ? "fade=in:st=0:d=0.5," : scene.kind === "outro" ? `fade=out:st=${(duration - 0.9).toFixed(2)}:d=0.9,` : "";
  parts.push(`${last}${fade}format=yuv420p[v]`);
  return [...inputs, "-filter_complex", parts.join(";"), "-map", "[v]", ...encodeArgs(duration, out)];
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
