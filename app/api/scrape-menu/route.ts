import { NextResponse } from "next/server";
import { MenuImportError, importMenu } from "@/lib/menu-import";

export const runtime = "nodejs";

/** POST /api/scrape-menu  { url: string }  ->  MenuImportResult (see lib/menu-import.ts) */
export async function POST(req: Request) {
  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  try {
    return NextResponse.json(await importMenu(typeof body.url === "string" ? body.url : ""));
  } catch (err) {
    if (err instanceof MenuImportError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
