import { stat } from "node:fs/promises";
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
import { deleteObject, listFolders, objectExists, objectFile, objectUrl, putObject, readObject } from "@/lib/storage";
import type { GenerateDoneEvent } from "@/lib/types";
import { JOBS_ROOT, jobOutputPath } from "@/lib/video-pipeline";
import { DEMO_PREFIX } from "@/lib/demo-menus";

/**
 * Saved projects, one folder each under projects/<id>/ in storage (lib/storage.ts):
 *   project.json  the ad, its dish library, the chat and the latest render
 *   thumb.jpg     dashboard thumbnail: a frame of the render, else the first dish photo
 * Rendered videos are saved to videos/<jobId>.mp4 because the render folders in $TMPDIR
 * get cleaned up by the OS (and on Vercel, only exist on the instance that rendered them).
 */

const ID = /^[a-z0-9-]{8,64}$/i;
export const isProjectId = (id: string) => ID.test(id);
const projectDir = (id: string) => `projects/${id}/`;
const recordKey = (id: string) => `${projectDir(id)}project.json`;
export const thumbKey = (id: string) => `${projectDir(id)}thumb.jpg`;

/** A chat message as the studio stores it (see ChatMessage in app/_components/shared.ts). */
export type StoredMessage = Record<string, unknown> & { id: string; role: "user" | "assistant"; text: string };

export interface ProjectRender extends Omit<GenerateDoneEvent, "type" | "videoUrl" | "downloadUrl"> {
  /** editKey() of what was rendered, so the editor can tell whether later edits are in the video. */
  editKey: string;
  renderedAt: number;
  /** Seconds the render took. */
  elapsed: number;
  /** Where to play it when it isn't in storage: an example's video shipped as a static file. */
  videoUrl?: string;
}

export interface ProjectRecord {
  id: string;
  /** The account that made it (lib/auth.ts). Examples and projects from before sign-in have none. */
  ownerId?: string;
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
    const json = await readObject(recordKey(id));
    return json ? (JSON.parse(json.toString("utf8")) as ProjectRecord) : null;
  } catch {
    return null;
  }
}

async function writeRecord(record: ProjectRecord) {
  await putObject(recordKey(record.id), Buffer.from(JSON.stringify(record)), "application/json");
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

/** Whether `userId` may open and change a project: their own, an example, or one saved before accounts existed. */
export const canAccess = (record: ProjectRecord | null, userId: string) => !record || record.id.startsWith(DEMO_PREFIX) || !record.ownerId || record.ownerId === userId;

/** Someone else's project. */
export class ProjectAccessError extends Error {}

/**
 * Save the editor's state. Render and publish history are owned by the server and kept.
 * `userId` is who's saving; null is the server itself, which only saves the examples.
 */
export async function saveProject(id: string, input: { project: unknown; library: unknown; messages: unknown }, userId: string | null): Promise<ProjectRecord> {
  const record = await mutate(id, (r) => {
    if (userId === null ? !id.startsWith(DEMO_PREFIX) : !canAccess(r, userId)) throw new ProjectAccessError("Not your project");
    return {
      ...r,
      // Whoever saves a project first owns it; the shared examples stay nobody's.
      ownerId: r.ownerId ?? (id.startsWith(DEMO_PREFIX) ? undefined : (userId ?? undefined)),
      updatedAt: Date.now(),
      project: sanitizeProject(input.project),
      library: sanitizeLibrary(input.library, 12 * 1024 * 1024),
      messages: sanitizeMessages(input.messages),
    };
  });
  if (!record.render) await refreshPhotoThumb(record).catch((err) => console.warn("[projects] thumbnail failed:", (err as Error).message));
  return record;
}

export async function deleteProject(id: string) {
  const record = await getProject(id);
  if (!record) return;
  await withLock(id, async () => {
    if (record.render) await deleteObject(videoKey(record.render.jobId));
    await deleteObject(projectDir(id));
  });
}

// ---------------------------------------------------------------------------
// Renders and publishing
// ---------------------------------------------------------------------------

const videoKey = (jobId: string) => `videos/${path.basename(jobId)}.mp4`;
/** Whether this instance still has the render folder (on Vercel, only the one that rendered it does). */
const renderedHere = (jobId: string) => stat(/*turbopackIgnore: true*/ jobOutputPath(jobId)).then((s) => s.isFile(), () => false);

/** Keep a finished render's video: the render folder is temporary. */
export async function saveVideo(jobId: string) {
  await putObject(videoKey(jobId), { file: jobOutputPath(jobId) }, "video/mp4");
}

/**
 * Where to get a job's MP4: a local file (the render folder while it exists, else the saved copy
 * on disk), or the saved copy's URL in Vercel Blob.
 */
export async function videoSource(jobId: string): Promise<{ file: string } | { url: string } | null> {
  if (await renderedHere(jobId)) return { file: jobOutputPath(jobId) };
  const url = await objectUrl(videoKey(jobId));
  if (url) return { url };
  const file = await objectFile(videoKey(jobId), jobOutputPath(jobId));
  return file ? { file } : null;
}

export async function hasVideo(jobId: string): Promise<boolean> {
  return (await renderedHere(jobId)) || (await objectExists(videoKey(jobId)));
}

/** The job's MP4 as a local file, downloading the saved copy if this instance didn't render it. */
export async function videoFile(jobId: string): Promise<string | null> {
  if (await renderedHere(jobId)) return jobOutputPath(jobId);
  return objectFile(videoKey(jobId), jobOutputPath(jobId));
}

/** Record a finished render (already saved with saveVideo) on its project and grab a thumbnail from it. */
export async function attachRender(id: string, done: Omit<ProjectRender, "renderedAt">, fallback: { project: AdProject; library: LibraryDish[] }) {
  let previous: string | undefined;
  const record = await mutate(id, (r) => {
    previous = r.render?.jobId;
    const fresh = !r.project.scenes.some((s) => s.kind === "dish");
    return { ...(fresh ? { ...r, ...fallback } : r), render: { ...done, renderedAt: Date.now() } };
  });
  // Keep old videos that were published; they're what the post links were made from.
  if (previous && previous !== done.jobId && !record.publishes.some((p) => p.jobId === previous)) await deleteObject(videoKey(previous));

  // A frame just after the first dish's name has animated in.
  const firstDish = done.timeline.find((t) => t.sceneId !== record.project.scenes[0].id) ?? done.timeline[0];
  const at = firstDish ? Math.min(firstDish.start + 2.2, firstDish.start + firstDish.duration - 0.2) : 1;
  try {
    const frame = path.join(JOBS_ROOT, done.jobId, "thumb.jpg");
    await runFfmpeg(["-y", "-ss", at.toFixed(2), "-i", jobOutputPath(done.jobId), "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "3", frame], 30_000);
    await putObject(thumbKey(id), { file: frame }, "image/jpeg");
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
  let jpg: Buffer | null = null;
  if (src) {
    const dataUri = /^data:image\/[a-z+.-]+;base64,/i.exec(src);
    const input = dataUri ? Buffer.from(src.slice(dataUri[0].length), "base64") : await fetchBuffer(src);
    jpg = await sharp(input).rotate().resize(640, 360, { fit: "cover" }).jpeg({ quality: 78 }).toBuffer();
  }
  await mutate(record.id, async (r) => {
    // A render may have landed meanwhile; its frame wins.
    if (r.render) return r;
    if (jpg) await putObject(thumbKey(r.id), jpg, "image/jpeg");
    else await deleteObject(thumbKey(r.id));
    return { ...r, thumbKey: key };
  });
}

export async function summarize(record: ProjectRecord): Promise<ProjectSummary> {
  const scenes = resolveScenes(record.project, record.library);
  const dishes = scenes.filter((s) => s.kind === "dish").map((s) => s.headline);
  const render = record.render && (await hasVideo(record.render.jobId)) ? record.render : undefined;
  const planned = planTimeline(
    scenes,
    scenes.map((s) => estimateVoiceSeconds(s.voice)),
  ).total;
  // Blob storage serves the thumbnail itself; on disk it goes through /api/projects/:id/thumb.
  const thumbBlob = record.thumbKey ? await objectUrl(thumbKey(record.id)) : null;
  const hasThumb = !!thumbBlob || (!!record.thumbKey && (await objectExists(thumbKey(record.id))));
  return {
    id: record.id,
    name: record.project.restaurant.trim(),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    dishes,
    durationSeconds: render ? render.durationSeconds : dishes.length ? planned : 0,
    durationEstimated: !render,
    status: !render ? "draft" : render.editKey === editKey(record.project, record.library) ? "ready" : "edited",
    thumbUrl: thumbBlob ?? (hasThumb ? `/api/projects/${record.id}/thumb?v=${encodeURIComponent(record.thumbKey!.slice(-24))}` : null),
    jobId: render?.jobId ?? null,
    publishes: record.publishes,
  };
}

/** The user's saved projects, most recently edited first. The shared example projects aren't anyone's, so they're left out. */
export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const ids = await listFolders("projects/");
  const records = (await Promise.all(ids.filter((id) => isProjectId(id) && !id.startsWith(DEMO_PREFIX)).map(getProject))).filter((r): r is ProjectRecord => !!r && r.ownerId === userId);
  const summaries = await Promise.all(records.map(summarize));
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}
