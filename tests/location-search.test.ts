import assert from "node:assert/strict";
import { test } from "node:test";
import { locationSearchLinks } from "../lib/locations";
import { searchLocations } from "../lib/location-search";
import { GET } from "../app/api/locations/route";
import { importMenu } from "../lib/menu-import";

test("name-and-city links encode punctuation correctly", () => {
  const links = locationSearchLinks("Joe's Pizza & Pasta", "Oakland, CA");
  assert.equal(new URL(links.google).searchParams.get("query"), "Joe's Pizza & Pasta Oakland, CA");
  assert.equal(new URL(links.yelp).searchParams.get("find_loc"), "Oakland, CA");
  assert.equal(new URL(links.yelp).searchParams.get("find_desc"), "Joe's Pizza & Pasta");
});

test("no-key lookup uses external search choices without fabricated results", async (t) => {
  const previous = [process.env.GOOGLE_PLACES_API_KEY, process.env.YELP_API_KEY, process.env.GEMINI_API_KEY];
  delete process.env.GOOGLE_PLACES_API_KEY; delete process.env.YELP_API_KEY; delete process.env.GEMINI_API_KEY;
  t.after(() => { for (const [i, key] of ["GOOGLE_PLACES_API_KEY", "YELP_API_KEY", "GEMINI_API_KEY"].entries()) { if (previous[i]) process.env[key] = previous[i]; else delete process.env[key]; } });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("No network request expected without keys"); });
  const result = await searchLocations("Pizza", "Berkeley");
  assert.deepEqual(result.locations, []);
  assert.match(result.notice!, /Google Maps or Yelp/);
  const invalid = await GET(new Request("http://localhost/api/locations?q=a"));
  assert.equal(invalid.status, 400);
});

test("configured providers return names, addresses and source links", async (t) => {
  const previous = [process.env.GOOGLE_PLACES_API_KEY, process.env.YELP_API_KEY];
  process.env.GOOGLE_PLACES_API_KEY = "test-google"; process.env.YELP_API_KEY = "test-yelp";
  t.after(() => { for (const [i, key] of ["GOOGLE_PLACES_API_KEY", "YELP_API_KEY"].entries()) { if (previous[i]) process.env[key] = previous[i]; else delete process.env[key]; } });
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (String(url).includes("googleapis")) {
      assert.equal(JSON.parse(String(init?.body)).textQuery, "Pizza in Berkeley");
      return Response.json({ places: [{ id: "g1", displayName: { text: "Pizza A" }, formattedAddress: "1 Main St", googleMapsUri: "https://maps.google.com/?cid=1" }] });
    }
    assert.equal(new URL(url).searchParams.get("location"), "Berkeley");
    return Response.json({ businesses: [{ id: "y1", name: "Pizza B", url: "https://www.yelp.com/biz/pizza-b", location: { display_address: ["2 Main St", "Berkeley"] } }] });
  });
  const result = await searchLocations("Pizza", "Berkeley");
  assert.deepEqual(result.locations.map((l) => [l.name, l.address, l.source]), [["Pizza A", "1 Main St", "google"], ["Pizza B", "2 Main St, Berkeley", "yelp"]]);
});

test("a blocked restaurant page never silently imports sample dishes", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 403 }));
  const menu = await importMenu("https://www.yelp.com/biz/test-restaurant");
  assert.equal(menu.source, "unavailable");
  assert.deepEqual(menu.dishes, []);
  assert.match(menu.note!, /Try address search/);
});
