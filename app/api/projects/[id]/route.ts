import { deleteProject, getProject, isProjectId, saveProject } from "@/lib/projects";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/projects/:id: the saved project, or 404. */
export async function GET(_req: Request, { params }: Ctx) {
  const record = await getProject((await params).id);
  return record ? Response.json(record) : Response.json({ error: "Not found" }, { status: 404 });
}

/** PUT /api/projects/:id  { project, library, messages }: autosave from the studio (creates the project on first save). */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!isProjectId(id)) return Response.json({ error: "Invalid project id" }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Expected a JSON body with { project, library, messages }" }, { status: 400 });
  }
  const record = await saveProject(id, { project: body.project, library: body.library, messages: body.messages });
  return Response.json({ updatedAt: record.updatedAt });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!isProjectId(id)) return Response.json({ error: "Invalid project id" }, { status: 400 });
  await deleteProject(id);
  return new Response(null, { status: 204 });
}
