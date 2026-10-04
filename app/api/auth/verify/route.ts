import { cookies } from "next/headers";
import { AuthError, isEmail, normalizeEmail, profileComplete, verifySignInCode } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";

/** POST /api/auth/verify  { email, code }: sign in. Responds { complete } (false: the profile still needs filling in). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; code?: unknown };
  const email = normalizeEmail(body.email);
  if (!isEmail(email) || typeof body.code !== "string") return Response.json({ error: "Enter the 6-digit code from the email." }, { status: 400 });
  try {
    const profile = await verifySignInCode(email, body.code);
    const { token, expires } = createSessionToken(profile.id);
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expires, req.url.startsWith("https:")));
    return Response.json({ complete: profileComplete(profile) });
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
