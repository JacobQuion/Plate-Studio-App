import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { demoForProject } from "@/lib/demo-menus";
import { bundledDemo } from "@/lib/demo-records";
import { currentUserId, requireOwner } from "@/lib/auth";
import { exampleTitles } from "@/lib/example-titles";
import { canAccess, getProject, hasVideo, isProjectId } from "@/lib/projects";
import { Studio } from "./Studio";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ template?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [record, userId] = await Promise.all([getProject((await params).id), currentUserId()]);
  const name = record && userId && canAccess(record, userId) ? record.project.restaurant.trim() : "";
  return { title: `${name || "New Project"} · Plate Studio` };
}

/**
 * The studio for one project. Unknown ids open as a new, empty project that's saved on first edit;
 * ?template=<id> starts it with that sample menu loaded. "demo-<id>" is a dashboard example: it
 * loads that sample and renders it the first time, then replays the saved render.
 */
export default async function StudioPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { template } = await searchParams;
  if (!isProjectId(id)) notFound();
  const owner = await requireOwner(`/studio/${id}`);
  const demo = demoForProject(id)?.id;
  // Examples ship with their video; otherwise the saved project.
  const record = (demo && bundledDemo(demo)) || (await getProject(id));
  if (!canAccess(record, owner.id)) notFound();
  // Drop a render whose video file is gone, so the studio offers to render again.
  if (record?.render && !record.render.videoUrl && !(await hasVideo(record.render.jobId))) delete record.render;
  const start = demo ?? (typeof template === "string" ? template : undefined);
  // A brand-new project starts unnamed ("New Project") and imports the menu from the owner's listing.
  const starter = !record && !start ? { link: owner.yelpUrl || owner.googleMapsUrl } : undefined;
  // A dashboard example's card title, which its studio edits in place of the restaurant name.
  const exampleTitle = demo ? (await exampleTitles(owner.id))[demo] : undefined;
  return <Studio key={id} id={id} initial={record} template={record ? undefined : start} demo={!!demo} exampleTitle={exampleTitle} starter={starter} />;
}
