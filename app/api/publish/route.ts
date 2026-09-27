import { cookies } from "next/headers";
import { isPlatform, PLATFORM_INFO, type Privacy } from "@/lib/platforms";
import { isProjectId, recordPublish, videoFile } from "@/lib/projects";
import { connectionCookie, cookieOptions, decodeConnection, encodeConnection, freshConnection, platformConfigured, publishVideo } from "@/lib/publish";

export const runtime = "nodejs";
// Instagram and TikTok process the upload before it goes live.
export const maxDuration = 300; // Vercel Hobby's ceiling; Pro allows up to 800.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * POST /api/publish  { platform, jobId, projectId?, title, caption, tags, privacy }
 * Uploads a rendered video to the platform as the account this browser connected.
 * Responds { url, note? } once it's live (or { error }).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { platform, jobId, projectId } = body;
  if (!isPlatform(platform)) return Response.json({ error: "Unknown platform" }, { status: 400 });
  if (typeof jobId !== "string" || !UUID.test(jobId)) return Response.json({ error: "Missing video" }, { status: 400 });
  const label = PLATFORM_INFO[platform].label;
  if (!platformConfigured(platform)) return Response.json({ error: `${label} publishing isn't set up on this server.` }, { status: 400 });

  const jar = await cookies();
  const saved = decodeConnection(jar.get(connectionCookie(platform))?.value);
  if (!saved) return Response.json({ error: `Connect ${label} first.`, reconnect: true }, { status: 401 });
  const file = await videoFile(jobId);
  if (!file) return Response.json({ error: "That video isn't on the server anymore. Render it again." }, { status: 404 });

  const privacy: Privacy = body.privacy === "private" || body.privacy === "unlisted" ? body.privacy : "public";
  const tags = Array.isArray(body.tags) ? body.tags.map((t) => str(t, 60)).filter(Boolean).slice(0, 20) : [];
  try {
    const connection = await freshConnection(platform, saved);
    if (connection !== saved) jar.set(connectionCookie(platform), encodeConnection(connection), cookieOptions(req.url.startsWith("https:")));
    const result = await publishVideo(platform, connection, file, { title: str(body.title, 200), caption: str(body.caption, 5000), tags, privacy });
    if (typeof projectId === "string" && isProjectId(projectId)) {
      await recordPublish(projectId, { platform, url: result.url, at: Date.now(), jobId }).catch((err) => console.warn("[publish] couldn't record:", err));
    }
    return Response.json(result);
  } catch (err) {
    console.error(`[publish] ${platform} failed:`, err);
    const message = (err as Error).message || `Publishing to ${label} failed`;
    // A revoked or expired sign-in: ask the user to connect again.
    const reconnect = /expired|invalid.*token|access_token|OAuthException|unauthori[sz]ed|401/i.test(message);
    return Response.json({ error: message, reconnect }, { status: 502 });
  }
}
