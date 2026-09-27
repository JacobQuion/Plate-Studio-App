import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import sharp from "sharp";
import { searchLocations } from "../lib/location-search";
import { locationSearchLinks, type RestaurantLocation } from "../lib/locations";
import { importRestaurant } from "../lib/restaurant-import";
import { parseMenuHtml } from "../lib/menu-import";
import { dishMotionInput } from "../lib/providers/video";
import { generateAd } from "../lib/video-pipeline";
import { newProject, sanitizeLibrary, setAdDishes } from "../lib/ad-plan";
import { renderProgress } from "../lib/render-progress";
import { freshStages } from "../app/_components/shared";
import { readRenderEvents, renderKey } from "../lib/render-client";
import { POST } from "../app/api/restaurant/route";
import type { Dish, ImportStreamEvent } from "../lib/types";

function env(t: TestContext, values: Record<string, string | undefined>) {
  const previous = new Map(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  t.after(() => { for (const [k, v] of previous) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}
const restaurant: RestaurantLocation = { id: "google-real-place", name: "Cafe Example", address: "12 Main St, Oakland, CA", source: "google", url: "https://www.google.com/maps/place/Cafe+Example" };
const menuHtml = `<script type="application/ld+json">${JSON.stringify({ "@type": "Menu", hasMenuItem: [
  { "@type": "MenuItem", name: "Roasted carrots", description: "Roasted carrots with herb dressing", offers: { price: "12", priceCurrency: "USD" } },
  { "@type": "MenuItem", name: "Mushroom toast", image: "/toast.jpg" },
] })}</script>`;
const grounded = (data: unknown, withSources = true) => Response.json({ candidates: [{
  content: { parts: [{ text: JSON.stringify(data) }] },
  ...(withSources ? { groundingMetadata: {
    groundingChunks: [{ web: { uri: "https://example.com/menu", title: "Cafe Example menu" } }],
    searchEntryPoint: { renderedContent: "<p>Google suggestions</p>" },
  } } : {}),
}] });

test("address-only lookup queries both providers and encodes external tabs", async (t) => {
  env(t, { GOOGLE_PLACES_API_KEY: "google-test", YELP_API_KEY: "yelp-test", GEMINI_API_KEY: undefined });
  const address = "12 Main St, Oakland, CA";
  const links = locationSearchLinks(address);
  assert.equal(new URL(links.yelp).searchParams.get("find_loc"), address);
  assert.equal(new URL(links.google).searchParams.get("query"), address);
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("googleapis")) {
      assert.equal(JSON.parse(String(init?.body)).textQuery, `restaurants at ${address}`);
      return Response.json({ places: [{ id: "real-place", displayName: { text: restaurant.name }, formattedAddress: address }] });
    }
    assert.equal(new URL(String(url)).searchParams.get("location"), address);
    assert.equal(new URL(String(url)).searchParams.get("term"), "restaurants");
    return Response.json({ businesses: [] });
  });
  assert.equal((await searchLocations(address)).locations[0].address, address);
});

test("Gemini key alone can search; ungrounded guesses are discarded", async (t) => {
  env(t, { GOOGLE_PLACES_API_KEY: undefined, YELP_API_KEY: undefined, GEMINI_API_KEY: "test" });
  const fetch = t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.tools, [{ googleSearch: {} }]);
    return grounded({ locations: [{ name: restaurant.name, address: restaurant.address, website: "https://example.com" }] });
  });
  const result = await searchLocations(restaurant.address);
  assert.equal(result.locations[0].source, "web");
  assert.equal(result.locations[0].sources?.[0].url, "https://example.com/menu");
  assert.match(result.searchSuggestions!, /Google suggestions/);
  fetch.mock.mockImplementation(async () => grounded({ locations: [{ name: "Made up", address: "Somewhere" }] }, false));
  assert.equal((await searchLocations(restaurant.address)).locations.length, 0);
});

test("menu items without photos survive import; duplicates and relative photos are handled", () => {
  const dishes = parseMenuHtml(menuHtml + menuHtml, "https://example.com/menu");
  assert.equal(dishes.length, 2);
  assert.equal(dishes[0].imageUrl, "");
  assert.equal(dishes[0].price, "$12.00");
  assert.equal(dishes[1].imageUrl, "https://example.com/toast.jpg");
  assert.ok(dishes.every((d) => d.visualMode === "generate" && d.evidence === "menu"));
});

test("place details lead to the official menu and stream an upload-free result", async (t) => {
  env(t, { GOOGLE_PLACES_API_KEY: "secret-test-key", GEMINI_API_KEY: undefined });
  const visited: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    visited.push(String(url));
    if (String(url).startsWith("https://places.googleapis.com/")) return Response.json({ displayName: { text: restaurant.name }, formattedAddress: restaurant.address, websiteUri: "https://example.com" });
    if (String(url).startsWith("https://www.google.com")) return new Response("Blocked", { status: 403 });
    return new Response(String(url).includes("/menu") ? menuHtml : '<a href="/menu">Our menu</a>', { headers: { "Content-Type": "text/html" } });
  });
  const response = await POST(new Request("http://localhost/api/restaurant", { method: "POST", body: JSON.stringify({ location: restaurant }) }));
  const events: ImportStreamEvent[] = [];
  for await (const event of readRenderEvents<ImportStreamEvent>(response.body!)) events.push(event);
  const done = events.at(-1);
  assert.equal(done?.type, "done");
  if (done?.type !== "done") return;
  assert.equal(done.result.dishes.length, 2);
  assert.equal(done.result.location?.website, "https://example.com/");
  assert.ok(done.result.dishes.every((d) => !d.imageUrl && d.visualMode === "generate"));
  assert.ok(visited.includes("https://example.com/menu"));
  assert.ok(!JSON.stringify(events).includes("secret-test-key"));
  const values = events.flatMap((e) => e.type === "progress" ? [e.progress] : []);
  assert.deepEqual(values, [...values].sort((a, b) => a - b));
  assert.equal(values.at(-1), 100);
});

test("Yelp food photos are analyzed when no menu exists, never copied or assigned invented prices", async (t) => {
  env(t, { YELP_API_KEY: "yelp-test", GEMINI_API_KEY: "gemini-test" });
  const picture = await sharp({ create: { width: 8, height: 8, channels: 3, background: "orange" } }).png().toBuffer();
  let sawImage = false;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("api.yelp.com")) return Response.json({ name: restaurant.name, photos: ["https://images.example.com/food.jpg"] });
    if (String(url).includes("generativelanguage")) {
      const body = JSON.parse(String(init?.body));
      if (body.tools) return grounded({ dishes: [] });
      sawImage = body.contents[0].parts.some((part: { inlineData?: unknown }) => !!part.inlineData);
      return grounded({ dishes: [{ title: "Roasted vegetables", description: "Golden vegetables on a white plate", price: "$99" }] });
    }
    if (String(url).includes("images.example.com")) return new Response(new Uint8Array(picture));
    return new Response("Blocked", { status: 403 });
  });
  const result = await importRestaurant({ ...restaurant, id: "yelp-real-business", source: "yelp", url: "https://www.yelp.com/biz/real-business" });
  assert.ok(sawImage);
  assert.equal(result.dishes[0].evidence, "photo");
  assert.equal(result.dishes[0].imageUrl, "");
  assert.equal(result.dishes[0].price, "");
  assert.match(result.note!, /Review the names/);
});

test("failed or empty sources never become sample restaurant dishes", async (t) => {
  env(t, { GOOGLE_PLACES_API_KEY: "test", GEMINI_API_KEY: undefined });
  t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 403 }));
  const result = await importRestaurant(restaurant);
  assert.equal(result.source, "unavailable");
  assert.deepEqual(result.dishes, []);
  assert.match(result.note!, /No readable public menu/);
  const invalid = await POST(new Request("http://localhost/api/restaurant", { method: "POST", body: JSON.stringify({ location: { ...restaurant, url: "http://127.0.0.1/admin" } }) }));
  assert.equal(invalid.status, 400);
});

test("generated dish references reach text-to-video and survive edits/serialization", () => {
  const dish: Dish = { id: "dish", title: "Carrots", description: "Herb dressing", price: "", imageUrl: "https://example.com/source.jpg", visualMode: "generate", visualDescription: "White plate", evidence: "menu", sourceUrl: "https://example.com/menu" };
  const [clean] = sanitizeLibrary([dish], 1000);
  assert.equal(clean.visualMode, "generate");
  assert.equal(clean.sourceUrl, dish.sourceUrl);
  const input = dishMotionInput(clean);
  assert.equal(input.image, null);
  assert.match(input.prompt, /Herb dressing/);
  assert.match(input.prompt, /White plate/);
  assert.doesNotMatch(input.prompt, /source.jpg/);
  assert.equal(dishMotionInput({ ...dish, visualMode: undefined }).image, dish.imageUrl);
  const project = setAdDishes(newProject(), [dish.id]);
  assert.notEqual(renderKey(project, [dish]), renderKey(project, [{ ...dish, visualDescription: "New plate" }]));
});

test("original scenes fail clearly without a provider or when generation fails; no source-photo fallback", async (t) => {
  env(t, { LUMA_API_KEY: undefined, REPLICATE_API_TOKEN: undefined, GEMINI_API_KEY: undefined, PEXELS_API_KEY: undefined });
  const dish: Dish = { id: "dish", title: "Carrots", price: "", description: "Roasted carrots", imageUrl: "https://example.com/never-download.jpg", visualMode: "generate" };
  const project = setAdDishes({ ...newProject(), lifestyle: false }, [dish.id]);
  project.scenes = project.scenes.map((s) => ({ ...s, voice: "" }));
  await assert.rejects(generateAd(project, [dish]), /needs a video API key/);
  process.env.LUMA_API_KEY = "test";
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), "https://api.lumalabs.ai/dream-machine/v1/generations");
    assert.equal(JSON.parse(String(init?.body)).keyframes, undefined);
    return new Response("Quota exceeded", { status: 429 });
  });
  await assert.rejects(generateAd(project, [dish]), /Couldn't generate original footage/);
});

test("progress counts parallel completed work and stays below 100 until the final file is ready", () => {
  const stages = freshStages();
  assert.equal(renderProgress(stages), 0);
  stages.assets = { status: "done" };
  stages.voice = { status: "done" };
  stages.motion = { status: "active", progress: 0.5 };
  assert.equal(renderProgress(stages), 47);
  stages.motion = { status: "done" };
  assert.equal(renderProgress(stages), 80);
  stages.assemble = { status: "done" };
  assert.equal(renderProgress(stages), 99);
});
