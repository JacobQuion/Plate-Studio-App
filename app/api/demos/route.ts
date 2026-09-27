import { after } from "next/server";
import { claimDemo, demoStatuses, renderDemo } from "@/lib/demos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A render runs after the response, within this route's time limit.
export const maxDuration = 300;

/**
 * POST /api/demos[?priority=<id>]  ->  { [demoId]: DemoStatus }
 * Starts rendering the next example without a video (one at a time), or `priority` right away.
 */
export async function POST(req: Request) {
  const priority = new URL(req.url).searchParams.get("priority") ?? undefined;
  const { statuses, start } = await demoStatuses(priority);
  for (const demo of start) {
    const { startedAt } = statuses[demo.id] as { startedAt: number };
    await claimDemo(demo, startedAt);
    after(() => renderDemo(demo, startedAt));
  }
  return Response.json(statuses, { headers: { "Cache-Control": "no-store" } });
}
