import { editKey, newProject, setAdDishes } from "@/lib/ad-plan";
import { DEMOS, demoProjectId, type DemoRestaurant } from "@/lib/demo-menus";
import { bundledDemo } from "@/lib/demo-records";
import { attachRender, getProject, saveProject, saveVideo } from "@/lib/projects";
import { deleteObject, putObject, readObject } from "@/lib/storage";
import { cloudVoiceConfigured } from "@/lib/providers/voice";
import { generateAd } from "@/lib/video-pipeline";

/**
 * The dashboard examples render on the server ahead of time, so opening one only replays its video.
 * One at a time (they'd share the voice API's per-minute limit), each in its own request to stay
 * inside the function time limit. demo-renders/<id>.json marks a render in progress (or the last
 * failure), so visitors don't start duplicates.
 */

/** Longer than a render can run (the route's maxDuration), so an older mark is from a render that died. */
const STALE_MS = 330_000;
/** A failed render is retried after this long. */
const RETRY_MS = 120_000;
/** A render that came out without a voice is redone after this long. */
const SILENT_RETRY_MS = 600_000;

type Mark = { startedAt: number; error?: string; failedAt?: number };
export type DemoStatus = { status: "ready" } | { status: "queued" } | { status: "rendering"; startedAt: number } | { status: "failed"; error: string };

const markKey = (demoId: string) => `demo-renders/${demoId}.json`;

async function readMark(demoId: string): Promise<Mark | null> {
  const buf = await readObject(markKey(demoId)).catch(() => null);
  try {
    return buf ? (JSON.parse(buf.toString("utf8")) as Mark) : null;
  } catch {
    return null;
  }
}

const writeMark = (demoId: string, mark: Mark) => putObject(markKey(demoId), Buffer.from(JSON.stringify(mark)), "application/json");

export const findDemo = (demoId: string) => DEMOS.find((d) => d.id === demoId);

/** The example's project as a fresh studio would load it. */
export function demoContent(demo: DemoRestaurant) {
  const project = setAdDishes({ ...newProject(), restaurant: demo.name, website: demo.website, cta: demo.cta }, demo.dishes.map((d) => d.id));
  const messages = [
    { id: "demo-intro", role: "assistant" as const, text: `This is a sample ad for ${demo.name}. Tell me what to change, and your edits are saved as a project of your own.` },
  ];
  return { project, library: demo.dishes, messages };
}

async function currentStatus(demo: DemoRestaurant): Promise<DemoStatus | { status: "idle" }> {
  if (bundledDemo(demo.id)) return { status: "ready" };
  // Trust the record's render: checking the video exists too would cost another storage call per poll.
  const record = await getProject(demoProjectId(demo.id));
  const now = Date.now();
  // A render without a voice (the voice API was out of quota) is redone once a voice may work again.
  const retryVoice = record?.render?.providers.voice === "silent" && cloudVoiceConfigured() && now - record.render.renderedAt > SILENT_RETRY_MS;
  if (record?.render && !retryVoice) return { status: "ready" };
  const mark = await readMark(demo.id);
  if (mark?.error && mark.failedAt && now - mark.failedAt < RETRY_MS) return { status: "failed", error: mark.error };
  if (mark && !mark.error && now - mark.startedAt < STALE_MS) return { status: "rendering", startedAt: mark.startedAt };
  return { status: "idle" };
}

/**
 * Every example's status. Starts the next render when none is running; `priority` (an example
 * someone has open) starts even if another is. Returns the ones to start; call claimDemo() on them.
 */
export async function demoStatuses(priority?: string): Promise<{ statuses: Record<string, DemoStatus>; start: DemoRestaurant[] }> {
  const current = await Promise.all(DEMOS.map(currentStatus));
  const idle = DEMOS.filter((_, i) => current[i].status === "idle");
  const busy = current.some((c) => c.status === "rendering");
  const start = [...idle.filter((d) => d.id === priority)];
  if (!busy && !start.length && idle.length) start.push(idle[0]);
  const now = Date.now();
  const statuses: Record<string, DemoStatus> = {};
  DEMOS.forEach((d, i) => {
    const c = current[i];
    statuses[d.id] = start.includes(d) ? { status: "rendering", startedAt: now } : c.status === "idle" ? { status: "queued" } : c;
  });
  return { statuses, start };
}

/** Mark the example as rendering before responding, so the next visitor sees it in progress. */
export const claimDemo = (demo: DemoRestaurant, startedAt: number) => writeMark(demo.id, { startedAt });

/** Render the example and save it to its project. Call after claimDemo(). */
export async function renderDemo(demo: DemoRestaurant, startedAt: number) {
  try {
    const record = await saveProject(demoProjectId(demo.id), demoContent(demo));
    const result = await generateAd(record.project, record.library);
    await saveVideo(result.jobId);
    const { jobId, durationSeconds, timeline, layout, script, providers } = result;
    await attachRender(
      record.id,
      { jobId, durationSeconds, timeline, layout, script, providers, editKey: editKey(record.project, record.library), elapsed: (Date.now() - startedAt) / 1000 },
      { project: record.project, library: record.library },
    );
    await deleteObject(markKey(demo.id));
  } catch (err) {
    console.error(`[demos] ${demo.id} render failed:`, err);
    await writeMark(demo.id, { startedAt, error: (err as Error).message.split("\n")[0] || "Render failed", failedAt: Date.now() }).catch(() => {});
  }
}
