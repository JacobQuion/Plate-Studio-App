import { currentUserId } from "@/lib/auth";
import { setExampleTitle } from "@/lib/example-titles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT /api/example-title  { demoId, title }: retitle a dashboard example for the signed-in owner. */
export async function PUT(req: Request) {
  const userId = await currentUserId();
  if (!userId) return new Response("Sign in first", { status: 401 });
  const body = (await req.json().catch(() => null)) as { demoId?: unknown; title?: unknown } | null;
  if (typeof body?.demoId !== "string" || typeof body.title !== "string") return new Response("Bad request", { status: 400 });
  try {
    await setExampleTitle(userId, body.demoId, body.title);
  } catch {
    return new Response("Unknown example", { status: 404 });
  }
  return new Response(null, { status: 204 });
}
