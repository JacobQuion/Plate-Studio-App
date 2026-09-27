import { searchLocations } from "@/lib/location-search";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, 240);
  const city = (params.get("city") ?? "").trim().slice(0, 120);
  if (query.length < 3) return Response.json({ error: "Enter a street address and city, or a restaurant name and city." }, { status: 400 });
  try {
    return Response.json(await searchLocations(query, city), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Search couldn't connect. Please try again." }, { status: 502 });
  }
}
