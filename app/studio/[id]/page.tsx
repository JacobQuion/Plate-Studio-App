import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { demoForProject } from "@/lib/demo-menus";
import { getProject, hasVideo, isProjectId } from "@/lib/projects";
import { Studio } from "./Studio";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ template?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const record = await getProject((await params).id);
  return { title: `${record?.project.restaurant.trim() || "New project"} · Plate Studio` };
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
  const record = await getProject(id);
  // Drop a render whose video file is gone, so the studio offers to render again.
  if (record?.render && !(await hasVideo(record.render.jobId))) delete record.render;
  const demo = demoForProject(id)?.id;
  const start = demo ?? (typeof template === "string" ? template : undefined);
  return <Studio key={id} id={id} initial={record} template={record ? undefined : start} demo={!!demo} />;
}
