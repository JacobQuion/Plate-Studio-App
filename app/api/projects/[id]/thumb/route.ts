import { isProjectId, thumbKey } from "@/lib/projects";
import { readObject } from "@/lib/storage";

export const runtime = "nodejs";

/** GET /api/projects/:id/thumb: the dashboard thumbnail (URLs carry a version, so it can be cached). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jpg = isProjectId(id) ? await readObject(thumbKey(id)) : null;
  if (!jpg) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(jpg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" } });
}
