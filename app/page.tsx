import { listProjects } from "@/lib/projects";
import { Dashboard } from "./_components/Dashboard";

export const dynamic = "force-dynamic";

/** Home: every saved project. The studio itself lives at /studio/[id]. */
export default async function Home() {
  return <Dashboard projects={await listProjects()} />;
}
