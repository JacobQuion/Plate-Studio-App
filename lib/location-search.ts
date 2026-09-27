import type { LocationSearchResult, RestaurantLocation } from "@/lib/locations";
import { locationSearchLinks } from "@/lib/locations";
import { groundedLocations } from "@/lib/restaurant-research";

async function googleSearch(query: string, city: string): Promise<RestaurantLocation[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY!, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.googleMapsUri" },
    body: JSON.stringify({ textQuery: city ? `${query} in ${city}` : `restaurants at ${query}`, pageSize: 10 }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Google Maps search is unavailable (${res.status}).`);
  const data = await res.json() as { places?: { id: string; displayName?: { text: string }; formattedAddress?: string; googleMapsUri?: string }[] };
  return (data.places ?? []).filter((p) => p.id && p.displayName?.text).map((p) => ({ id: `google-${p.id}`, name: p.displayName!.text, address: p.formattedAddress ?? "", source: "google", url: p.googleMapsUri ?? locationSearchLinks(p.displayName!.text, p.formattedAddress ?? city).google }));
}

async function yelpSearch(query: string, city: string): Promise<RestaurantLocation[]> {
  const url = `https://api.yelp.com/v3/businesses/search?${new URLSearchParams({ term: city ? query : "restaurants", location: city || query, categories: "restaurants,food,bars", limit: "10" })}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.YELP_API_KEY}` }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Yelp search is unavailable (${res.status}).`);
  const data = await res.json() as { businesses?: { id: string; name: string; url: string; location?: { display_address?: string[] } }[] };
  return (data.businesses ?? []).filter((b) => b.id && b.name && b.url).map((b) => ({ id: `yelp-${b.id}`, name: b.name, address: b.location?.display_address?.join(", ") ?? "", source: "yelp", url: b.url }));
}

export async function searchLocations(query: string, city = ""): Promise<LocationSearchResult> {
  const jobs: Promise<RestaurantLocation[]>[] = [];
  if (process.env.GOOGLE_PLACES_API_KEY) jobs.push(googleSearch(query, city));
  if (process.env.YELP_API_KEY) jobs.push(yelpSearch(query, city));
  const responses = await Promise.allSettled(jobs);
  const locations = responses.flatMap((r) => r.status === "fulfilled" ? r.value : []);
  const failures = responses.filter((r) => r.status === "rejected");
  if (!locations.length && process.env.GEMINI_API_KEY) {
    try { return await groundedLocations(`${query} ${city}`.trim()); }
    catch { return { locations: [], notice: "Restaurant lookup couldn't connect. Try again, or check the address on Google Maps or Yelp." }; }
  }
  if (!jobs.length) return { locations: [], notice: "Automatic address lookup needs a Gemini, Google Places, or Yelp API key in server settings. You can still open this address on Google Maps or Yelp below." };
  return { locations, ...(failures.length ? { notice: "One search service couldn't respond. Try again, or open your search below." } : !locations.length ? { notice: "No matching restaurants found. Try a more specific name or a nearby city." } : {}) };
}
