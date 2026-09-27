import type { RestaurantLocation } from "@/lib/locations";
import type { ImportStreamEvent } from "@/lib/types";
import { importRestaurant } from "@/lib/restaurant-import";
import { publicUrl } from "@/lib/restaurant-research";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  let location: RestaurantLocation;
  try {
    const { location: value } = await req.json();
    if (!value || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.address !== "string" || !["google", "yelp", "web", "manual"].includes(value.source) || !publicUrl(value.url)) throw new Error("Invalid location");
    location = { id: value.id.slice(0, 200), name: value.name.slice(0, 120), address: value.address.slice(0, 240), source: value.source, url: publicUrl(value.url)!, website: publicUrl(value.website) };
  } catch {
    return Response.json({ error: "Select a restaurant from address search first." }, { status: 400 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ImportStreamEvent) => {
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch {}
      };
      try {
        const result = await importRestaurant(location, (progress, detail) => send({ type: "progress", progress, detail }));
        send({ type: "done", result });
      } catch {
        send({ type: "error", message: "Restaurant import couldn't finish. Please try again." });
      } finally { try { controller.close(); } catch {} }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
