import { requireOwner } from "@/lib/auth";
import { exampleTitles } from "@/lib/example-titles";
import { listProjects } from "@/lib/projects";
import { Dashboard } from "./_components/Dashboard";

export const dynamic = "force-dynamic";

/** Home: every saved project. The studio itself lives at /studio/[id]. */
export default async function Home() {
  const owner = await requireOwner("/");
  return (
    <Dashboard
      projects={await listProjects(owner.id)}
      exampleTitles={await exampleTitles(owner.id)}
      owner={{ firstName: owner.firstName, lastName: owner.lastName, email: owner.email, restaurant: owner.restaurant }}
    />
  );
}
