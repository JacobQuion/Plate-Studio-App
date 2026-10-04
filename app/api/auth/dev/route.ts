import { cookies } from "next/headers";
import { devPassEnabled, devPassProfile } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";

/** POST /api/auth/dev: temporary developer pass. Signs in as a test account; local dev server only. */
export async function POST(req: Request) {
  if (!devPassEnabled()) return Response.json({ error: "Not found" }, { status: 404 });
  const profile = await devPassProfile();
  const { token, expires } = createSessionToken(profile.id);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expires, req.url.startsWith("https:")));
  return Response.json({ ok: true });
}
