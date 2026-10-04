import { AuthError, isEmail, normalizeEmail, sendSignInCode } from "@/lib/auth";

export const runtime = "nodejs";

/** POST /api/auth/code  { email }: email a sign-in code. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: unknown };
  const email = normalizeEmail(body.email);
  if (!isEmail(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  try {
    return Response.json(await sendSignInCode(email));
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: 429 });
    throw err;
  }
}
