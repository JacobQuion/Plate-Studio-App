import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  editKey,
  estimateVoiceSeconds,
  planTimeline,
  resolveScenes,
  sanitizeLibrary,
  sanitizeProject,
  type AdProject,
  type LibraryDish,
} from "@/lib/ad-plan";
import { runFfmpeg } from "@/lib/ffmpeg";
import { fetchBuffer } from "@/lib/safe-fetch";
import type { PublishRecord } from "@/lib/platforms";
import type { GenerateDoneEvent } from "@/lib/types";
import { jobOutputPath } from "@/lib/video-pipeline";

/**
 * Saved projects, one folder each under .data/projects/<id>/:
 *   project.json  the ad, its dish library, the chat and the latest render
 *   thumb.jpg     dashboard thumbnail: a frame of the render, else the first dish photo
 * Rendered videos are copied to .data/videos/<jobId>.mp4 because the render
 * folders in $TMPDIR get cleaned up by the OS.
 */

export const DATA_ROOT = process.env.PLATE_STUDIO_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), ".data");
const PROJECTS_ROOT = path.join(DATA_ROOT, "projects");
const VIDEOS_ROOT = path.join(DATA_ROOT, "videos");

const ID = /^[a-z0-9-]{8,64}$/i;
export const isProjectId = (id: string) => ID.test(id);
const projectDir = (id: string) => path.join(PROJECTS_ROOT, id);
const recordPath = (id: string) => path.join(projectDir(id), "project.json");
export const thumbPath = (id: string) => path.join(projectDir(id), "thumb.jpg");

/** A chat message as the studio stores it (see ChatMessage in app/_components/shared.ts). */
export type StoredMessage = Record<string, unknown> & { id: string; role: "user" | "assistant"; text: string };

export interface ProjectRender extends Omit<GenerateDoneEvent, "type" | "videoUrl" | "downloadUrl"> {
  /** editKey() of what was rendered, so the editor can tell whether later edits are in the video. */
  editKey: string;
  renderedAt: number;
  /** Seconds the render took. */
  elapsed: number;
}

export interface ProjectRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  project: AdProject;
  library: LibraryDish[];
  messages: StoredMessage[];
  render?: ProjectRender;
  publishes: PublishRecord[];
  /** What thumb.jpg was made from, so it's only rebuilt when that changes. */
  thumbKey?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  dishes: string[];
  durationSeconds: number;
  /** No render yet, so the duration is planned from the script. */
  durationEstimated: boolean;
  status: "draft" | "ready" | "edited";
  thumbUrl: string | null;
  /** The last render, when its file is still around. */
  jobId: string | null;
  publishes: PublishRecord[];
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Serialize writes per project: autosaves and render/publish results land concurrently. */
const locks: Map<string, Promise<unknown>> = ((globalThis as { __projectLocks?: Map<string, Promise<unknown>> }).__projectLocks ??= new Map());
function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(id) ?? Promise.resolve()).then(fn, fn);
  locks.set(id, run.catch(() => {}));
  return run;
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  if (!isProjectId(id)) return null;
  try {
    return JSON.parse(await readFile(recordPath(id), "utf8")) as ProjectRecord;
  } catch {
    return null;
  }
}

async function writeRecord(record: ProjectRecord) {
  await mkdir(projectDir(record.id), { recursive: true });
  const tmp = `${recordPath(record.id)}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(record));
  await rename(tmp, recordPath(record.id));
}

/** Update a project (creating it if needed) under the per-project lock. */
function mutate(id: string, fn: (r: ProjectRecord) => ProjectRecord | Promise<ProjectRecord>): Promise<ProjectRecord> {
  if (!isProjectId(id)) return Promise.reject(new Error("Invalid project id"));
  return withLock(id, async () => {
    const now = Date.now();
    const current = (await getProject(id)) ?? { id, createdAt: now, updatedAt: now, project: sanitizeProject({}), library: [], messages: [], publishes: [] };
    const next = await fn(current);
    await writeRecord(next);
    return next;
  });
}

export function sanitizeMessages(raw: unknown): StoredMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-300).flatMap((m) => {
    if (!m || typeof m !== "object") return [];
    const o = m as Record<string, unknown>;
    if (typeof o.id !== "string" || (o.role !== "user" && o.role !== "assistant") || typeof o.text !== "string") return [];
    const images = Array.isArray(o.images) ? o.images.filter((i): i is string => typeof i === "string" && /^(https?:|data:image\/)/.test(i)).slice(0, 12) : undefined;
    const actions = Array.isArray(o.actions) ? o.actions.filter((a): a is string => typeof a === "string").slice(0, 30) : undefined;
    return [{ id: o.id.slice(0, 64), role: o.role, text: o.text.slice(0, 20_000), images, actions, error: o.error === true || undefined, reverted: o.reverted === true || undefined }];
  });
}

/** Save the editor's state. Render and publish history are owned by the server and kept. */
export async function saveProject(id: string, input: { project: unknown; library: unknown; messages: unknown }): Promise<ProjectRecord> {
  const record = await mutate(id, (r) => ({
    ...r,
    updatedAt: Date.now(),
    project: sanitizeProject(input.project),
    library: sanitizeLibrary(input.library, 12 * 1024 * 1024),
    messages: sanitizeMessages(input.messages),
  }));
  if (!record.render) await refreshPhotoThumb(record).catch((err) => console.warn("[projects] thumbnail failed:", (err as Error).message));
  return record;
}

export async function deleteProject(id: string) {
  const record = await getProject(id);
  if (!record) return;
  await withLock(id, async () => {
    if (record.render) await rm(savedVideoPath(record.render.jobId), { force: true });
    await rm(projectDir(id), { recursive: true, force: true });
  });
}

// ---------------------------------------------------------------------------
// Renders and publishing
// ---------------------------------------------------------------------------

const savedVideoPath = (jobId: string) => path.join(VIDEOS_ROOT, `${path.basename(jobId)}.mp4`);

/** The rendered MP4 for a job: the render folder while it exists, else the saved copy. */
export async function videoPath(jobId: string): Promise<string | null> {
  for (const file of [jobOutputPath(jobId), savedVideoPath(jobId)]) {
    if (await stat(/*turbopackIgnore: true*/ file).then((s) => s.isFile(), () => false)) return file;
  }
  return null;
}

/** Record a finished render on its project: keep a copy of the video and grab a thumbnail from it. */
export async function attachRender(id: string, done: Omit<ProjectRender, "renderedAt">, fallback: { project: AdProject; library: LibraryDish[] }) {
  await mkdir(VIDEOS_ROOT, { recursive: true });
  await copyFile(jobOutputPath(done.jobId), savedVideoPath(done.jobId));
  let previous: string | undefined;
  const record = await mutate(id, (r) => {
    previous = r.render?.jobId;
    const fresh = !r.project.scenes.some((s) => s.kind === "dish");
    return { ...(fresh ? { ...r, ...fallback } : r), render: { ...done, renderedAt: Date.now() } };
  });
  // Keep old videos that were published; they're what the post links were made from.
  if (previous && previous !== done.jobId && !record.publishes.some((p) => p.jobId === previous)) await rm(savedVideoPath(previous), { force: true });

  // A frame just after the first dish's name has animated in.
  const firstDish = done.timeline.find((t) => t.sceneId !== record.project.scenes[0].id) ?? done.timeline[0];
  const at = firstDish ? Math.min(firstDish.start + 2.2, firstDish.start + firstDish.duration - 0.2) : 1;
  try {
    await runFfmpeg(["-ss", at.toFixed(2), "-i", savedVideoPath(done.jobId), "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "3", thumbPath(id)], 30_000);
    await mutate(id, (r) => ({ ...r, thumbKey: `render:${done.jobId}` }));
  } catch (err) {
    console.warn("[projects] render thumbnail failed:", (err as Error).message);
  }
}

export function recordPublish(id: string, entry: PublishRecord) {
  return mutate(id, (r) => ({ ...r, publishes: [...r.publishes, entry] }));
}

// ---------------------------------------------------------------------------
// Thumbnails + dashboard
// ---------------------------------------------------------------------------

/** Before the first render, the thumbnail is the first featured dish's photo. */
async function refreshPhotoThumb(record: ProjectRecord) {
  const scenes = resolveScenes(record.project, record.library);
  const src = scenes.find((s) => s.kind === "dish")?.imageUrl || record.library.find((d) => d.imageUrl)?.imageUrl || "";
  const key = src ? `photo:${src.length}:${src.slice(0, 64)}:${src.slice(-64)}` : undefined;
  if (key === record.thumbKey) return;
  const tmp = `${thumbPath(record.id)}.${process.pid}.tmp`;
  if (src) {
    const dataUri = /^data:image\/[a-z+.-]+;base64,/i.exec(src);
    const input = dataUri ? Buffer.from(src.slice(dataUri[0].length), "base64") : await fetchBuffer(src);
    await sharp(input).rotate().resize(640, 360, { fit: "cover" }).jpeg({ quality: 78 }).toFile(tmp);
  }
  await mutate(record.id, async (r) => {
    // A render may have landed meanwhile; its frame wins.
    if (r.render) return r;
    if (src) await rename(tmp, thumbPath(r.id));
    else await rm(thumbPath(r.id), { force: true });
    return { ...r, thumbKey: key };
  });
  await rm(tmp, { force: true });
}

export async function summarize(record: ProjectRecord): Promise<ProjectSummary> {
  const scenes = resolveScenes(record.project, record.library);
  const dishes = scenes.filter((s) => s.kind === "dish").map((s) => s.headline);
  const render = record.render && (await videoPath(record.render.jobId)) ? record.render : undefined;
  const planned = planTimeline(
    scenes,
    scenes.map((s) => estimateVoiceSeconds(s.voice)),
  ).total;
  const hasThumb = !!record.thumbKey && (await stat(thumbPath(record.id)).then(() => true, () => false));
  return {
    id: record.id,
    name: record.project.restaurant.trim(),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    dishes,
    durationSeconds: render ? render.durationSeconds : dishes.length ? planned : 0,
    durationEstimated: !render,
    status: !render ? "draft" : render.editKey === editKey(record.project, record.library) ? "ready" : "edited",
    thumbUrl: hasThumb ? `/api/projects/${record.id}/thumb?v=${encodeURIComponent(record.thumbKey!.slice(-24))}` : null,
    jobId: render?.jobId ?? null,
    publishes: record.publishes,
  };
}

/** Every saved project, most recently edited first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const ids = await readdir(PROJECTS_ROOT).catch(() => [] as string[]);
  const records = (await Promise.all(ids.filter(isProjectId).map(getProject))).filter((r): r is ProjectRecord => !!r);
  const summaries = await Promise.all(records.map(summarize));
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}
