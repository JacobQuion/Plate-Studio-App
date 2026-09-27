import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { isPlatform, PLATFORM_INFO } from "@/lib/platforms";
import { authorizeUrl, connectionCookie, platformConfigured, redirectUri, STATE_COOKIE } from "@/lib/publish";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ platform: string }> };

/** GET /api/connect/:platform: start signing in (opened in a popup by the export dialog). */
export async function GET(req: Request, { params }: Ctx) {
  const { platform } = await params;
  if (!isPlatform(platform)) return new Response("Unknown platform", { status: 404 });
  if (!platformConfigured(platform)) return new Response(`${PLATFORM_INFO[platform].label} publishing isn't set up on this server. Add its app keys to .env.local.`, { status: 400 });
  const state = `${platform}.${randomBytes(16).toString("hex")}`;
  (await cookies()).set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: req.url.startsWith("https:"), path: "/", maxAge: 600 });
  // Not Response.redirect(): its headers are immutable, so the state cookie couldn't be attached.
  return new Response(null, { status: 302, headers: { Location: authorizeUrl(platform, redirectUri(req, platform), state) } });
}

/** DELETE /api/connect/:platform: forget this browser's sign-in. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { platform } = await params;
  if (!isPlatform(platform)) return new Response("Unknown platform", { status: 404 });
  (await cookies()).delete(connectionCookie(platform));
  return new Response(null, { status: 204 });
}
