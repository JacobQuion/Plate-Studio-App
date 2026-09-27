import { listProjects } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/projects: summaries of every saved project, most recently edited first. */
export async function GET() {
  return Response.json(await listProjects());
}
