import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isPlatform, PLATFORM_INFO, PLATFORM_SETUP, type SetupInfo } from "@/lib/platforms";
import { publicOrigin } from "@/lib/publish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only the local dev server writes keys; a deployed app reads them from its host's settings.
const editable = () => process.env.NODE_ENV === "development";
const ENV_FILE = path.join(process.cwd(), ".env.local");
// Rules out anything .env parsing would treat specially: whitespace, quotes, comments, $ expansion.
const SAFE_VALUE = /^[^\s"'`#$\\]*$/;

/** GET /api/connect/setup: what the Set up panel needs to build redirect URLs. */
export async function GET(req: Request) {
  const info: SetupInfo = { editable: editable(), publicUrl: process.env.PUBLIC_URL ?? "", origin: publicOrigin(req) };
  return Response.json(info);
}

/**
 * POST /api/connect/setup  { platform, values: { ENV_NAME: value }, publicUrl? }
 * Saves a platform's app keys to .env.local and applies them right away.
 */
export async function POST(req: Request) {
  if (!editable()) return Response.json({ error: "Keys can only be saved from the local dev server. Add them to your host's environment variables instead." }, { status: 403 });
  // Same-origin only, so another site can't swap in its own app keys.
  const origin = req.headers.get("origin");
  if (!origin || new URL(origin).host !== req.headers.get("host")) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { platform?: unknown; values?: Record<string, unknown>; publicUrl?: unknown };
  if (!isPlatform(body.platform)) return Response.json({ error: "Unknown platform" }, { status: 400 });
  const setup = PLATFORM_SETUP[body.platform];
  const updates: Record<string, string> = {};
  for (const key of setup.keys) {
    const value = typeof body.values?.[key.env] === "string" ? (body.values[key.env] as string).trim() : "";
    if (!value && !key.optional) return Response.json({ error: `Enter the ${key.label}.` }, { status: 400 });
    if (value.length > 500 || !SAFE_VALUE.test(value)) return Response.json({ error: `That ${key.label} doesn't look right. Copy it again without spaces or quotes.` }, { status: 400 });
    updates[key.env] = value;
  }
  if (typeof body.publicUrl === "string") {
    const url = body.publicUrl.trim().replace(/\/+$/, "");
    if (url && (!/^https?:\/\/[^\s/]+$/.test(url) || !SAFE_VALUE.test(url))) return Response.json({ error: "The public URL should look like https://example.ngrok.app" }, { status: 400 });
    updates.PUBLIC_URL = url;
  }

  try {
    await writeEnv(updates);
  } catch (err) {
    console.error("[setup] couldn't write .env.local:", err);
    return Response.json({ error: "Couldn't save to .env.local." }, { status: 500 });
  }
  for (const [k, v] of Object.entries(updates)) {
    if (v) process.env[k] = v;
    else delete process.env[k];
  }
  console.log(`[setup] saved ${PLATFORM_INFO[body.platform].label} keys to .env.local`);
  return Response.json({ ok: true });
}

/** Set each key in .env.local, replacing an existing line or appending a new one. */
async function writeEnv(updates: Record<string, string>) {
  const text = await readFile(ENV_FILE, "utf8").catch(() => "");
  const lines = text ? text.replace(/\n$/, "").split("\n") : [];
  for (const [key, value] of Object.entries(updates)) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*(export\\s+)?${key}\\s*=`).test(l));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  await writeFile(ENV_FILE, `${lines.join("\n")}\n`, { mode: 0o600 });
}
