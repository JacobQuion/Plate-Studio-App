import { TEMPLATES } from "@/lib/demo-menus";
import { bundledDemo } from "@/lib/demo-records";
import { putObject, readObject } from "@/lib/storage";

/**
 * Each owner can retitle the dashboard examples. The examples themselves are shared, so a new title
 * is saved per owner in example-titles/<userId>.json and changes only that owner's cards.
 */

const MAX_TITLE = 80;
const titlesKey = (userId: string) => `example-titles/${encodeURIComponent(userId)}.json`;

/** "Example N: <the name its project opens with>". */
export function defaultExampleTitle(demoId: string): string {
  const i = TEMPLATES.findIndex((t) => t.id === demoId);
  const name = bundledDemo(demoId)?.project.restaurant.trim() || TEMPLATES[i]?.name || "";
  return i >= 0 ? `Example ${i + 1}: ${name}` : name;
}

async function savedTitles(userId: string): Promise<Record<string, string>> {
  const buf = await readObject(titlesKey(userId)).catch(() => null);
  try {
    return buf ? (JSON.parse(buf.toString("utf8")) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Every featured example's title for this owner, by demo id. */
export async function exampleTitles(userId: string): Promise<Record<string, string>> {
  const saved = await savedTitles(userId);
  return Object.fromEntries(TEMPLATES.map((t) => [t.id, saved[t.id] || defaultExampleTitle(t.id)]));
}

/** Save an owner's title for one example; a blank title goes back to the default. */
export async function setExampleTitle(userId: string, demoId: string, title: string): Promise<void> {
  if (!TEMPLATES.some((t) => t.id === demoId)) throw new Error("Unknown example");
  const saved = await savedTitles(userId);
  const clean = title.trim().slice(0, MAX_TITLE);
  if (clean && clean !== defaultExampleTitle(demoId)) saved[demoId] = clean;
  else delete saved[demoId];
  await putObject(titlesKey(userId), Buffer.from(JSON.stringify(saved)), "application/json");
}
