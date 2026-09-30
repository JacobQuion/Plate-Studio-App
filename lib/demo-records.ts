import type { ProjectRecord } from "@/lib/projects";
import records from "./demo-records.json";

/**
 * The examples, rendered ahead of time and shipped with the app: their videos are static files in
 * public/demos/, so opening one never depends on a render, an API key or storage on the server.
 * To refresh one, render it locally and rebuild demo-records.json and public/demos/<id>.mp4.
 */
export const bundledDemo = (demoId: string): ProjectRecord | null => (records as unknown as Record<string, ProjectRecord>)[demoId] ?? null;
