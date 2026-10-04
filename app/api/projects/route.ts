import { currentUserId } from "@/lib/auth";
import { listProjects } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/projects: summaries of the signed-in owner's projects, most recently edited first. */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  return Response.json(await listProjects(userId));
}
