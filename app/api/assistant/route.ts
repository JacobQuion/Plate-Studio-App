import { sanitizeLibrary, sanitizeProject } from "@/lib/ad-plan";
import { runAssistant, type Attachment, type ChatTurn, type Focus } from "@/lib/assistant";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/assistant  { history: ChatTurn[], attachments: Attachment[], project, library, focus? }
 *   -> AssistantResult (the edited project + library, the reply and suggestions)
 *
 * The browser strips uploaded photos out of `library` (they stay client-side)
 * and sends small thumbnails of this turn's new photos as `attachments`.
 * `focus` is the section of the ad the user picked on the timeline, if any.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const history = (Array.isArray(body.history) ? (body.history as Record<string, unknown>[]) : [])
    .slice(-30)
    .map((t): ChatTurn => ({ role: t.role === "assistant" ? "assistant" : "user", text: String(t.text ?? "").slice(0, 4000) }));
  if (!history.length || history[history.length - 1].role !== "user") {
    return Response.json({ error: "The last message must be from the user" }, { status: 400 });
  }
  const attachments = (Array.isArray(body.attachments) ? (body.attachments as Record<string, unknown>[]) : [])
    .slice(0, 8)
    .map((a): Attachment => ({ dishId: String(a.dishId ?? ""), thumb: String(a.thumb ?? "").slice(0, 400_000) }))
    .filter((a) => a.dishId);
  const f = body.focus as Record<string, unknown> | null | undefined;
  const focus: Focus | null =
    f && typeof f === "object" && Array.isArray(f.sceneIds)
      ? { start: Number(f.start) || 0, end: Number(f.end) || 0, sceneIds: f.sceneIds.slice(0, 40).map(String) }
      : null;

  try {
    const result = await runAssistant({
      history,
      attachments,
      project: sanitizeProject(body.project),
      library: sanitizeLibrary(body.library, 4000),
      focus,
    });
    return Response.json(result);
  } catch (err) {
    console.error("[assistant] failed:", err);
    return Response.json({ error: "The assistant hit an error. Try again, or edit the ad directly below the video." }, { status: 502 });
  }
}
