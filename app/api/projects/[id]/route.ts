import { currentUserId } from "@/lib/auth";
import { canAccess, deleteProject, getProject, isProjectId, ProjectAccessError, saveProject } from "@/lib/projects";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const signedOut = () => Response.json({ error: "Sign in to continue." }, { status: 401 });
// Someone else's project looks the same as one that doesn't exist.
const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

/** GET /api/projects/:id: the saved project, or 404. */
export async function GET(_req: Request, { params }: Ctx) {
  const userId = await currentUserId();
  if (!userId) return signedOut();
  const record = await getProject((await params).id);
  return record && canAccess(record, userId) ? Response.json(record) : notFound();
}

/** PUT /api/projects/:id  { project, library, messages }: autosave from the studio (creates the project on first save). */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!isProjectId(id)) return Response.json({ error: "Invalid project id" }, { status: 400 });
  const userId = await currentUserId();
  if (!userId) return signedOut();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Expected a JSON body with { project, library, messages }" }, { status: 400 });
  }
  try {
    const record = await saveProject(id, { project: body.project, library: body.library, messages: body.messages }, userId);
    return Response.json({ updatedAt: record.updatedAt });
  } catch (err) {
    if (err instanceof ProjectAccessError) return notFound();
    throw err;
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!isProjectId(id)) return Response.json({ error: "Invalid project id" }, { status: 400 });
  const userId = await currentUserId();
  if (!userId) return signedOut();
  const record = await getProject(id);
  // Only the owner deletes, and never a shared example.
  if (!record || record.ownerId !== userId) return notFound();
  await deleteProject(id);
  return new Response(null, { status: 204 });
}
