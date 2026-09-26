import { sanitizeLibrary, sanitizeProject, type AdProject, type LibraryDish } from "@/lib/ad-plan";
import { generateAd } from "@/lib/video-pipeline";
import type { GenerateStreamEvent } from "@/lib/types";

export const runtime = "nodejs";
// A 30 second ad renders ~5-8 scenes; AI video providers can add a couple of minutes.
export const maxDuration = 600;

/**
 * POST /api/generate  { project: AdProject, library: LibraryDish[] }
 *
 * Library images are public http(s) URLs or base64 image data URIs (uploads).
 * Renders the ad and streams progress back as NDJSON (one GenerateStreamEvent
 * per line). The final line is either { type: "done", videoUrl, ... } or { type: "error" }.
 */
export async function POST(req: Request) {
  let project: AdProject;
  let library: LibraryDish[];
  try {
    const body = (await req.json()) as Record<string, unknown>;
    project = sanitizeProject(body.project);
    library = sanitizeLibrary(body.library, 12 * 1024 * 1024);
  } catch {
    return Response.json({ error: "Expected a JSON body with { project, library }" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: GenerateStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Client disconnected; keep rendering so the file still lands on disk.
        }
      };
      try {
        const result = await generateAd(project, library, send);
        send({
          type: "done",
          jobId: result.jobId,
          videoUrl: `/api/video/${result.jobId}`,
          downloadUrl: `/api/video/${result.jobId}?download=1`,
          durationSeconds: result.durationSeconds,
          timeline: result.timeline,
          layout: result.layout,
          script: result.script,
          providers: result.providers,
        });
      } catch (err) {
        console.error("[generate] pipeline failed:", err);
        send({ type: "error", message: (err as Error).message.split("\n")[0] || "Video generation failed" });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
