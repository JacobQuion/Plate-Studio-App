import { cookies } from "next/headers";
import { PLATFORMS, type ConnectionsResponse } from "@/lib/platforms";
import { connectionCookie, decodeConnection, platformConfigured } from "@/lib/publish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connect: which platforms are set up on the server and signed in from this browser. */
export async function GET() {
  const jar = await cookies();
  const out = {} as ConnectionsResponse;
  for (const p of PLATFORMS) {
    const configured = platformConfigured(p);
    const c = configured ? decodeConnection(jar.get(connectionCookie(p))?.value) : null;
    out[p] = { configured, connected: !!c, account: c?.account };
  }
  return Response.json(out);
}
