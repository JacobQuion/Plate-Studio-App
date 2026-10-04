import { AuthError, currentUser, currentUserId, updateProfile } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/profile: the signed-in owner's details. */
export async function GET() {
  const user = await currentUser();
  return user ? Response.json(user) : Response.json({ error: "Not signed in" }, { status: 401 });
}

/** PUT /api/auth/profile  { firstName, lastName, restaurant, googleMapsUrl, yelpUrl } */
export async function PUT(req: Request) {
  const id = await currentUserId();
  if (!id) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return Response.json(await updateProfile(id, body));
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
