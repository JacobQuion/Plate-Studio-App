import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { newProject, setAdDishes } from "../lib/ad-plan";
import { downloadRenderedVideo, readRenderEvents, renderKey } from "../lib/render-client";
import { Preview } from "../app/_components/Preview";
import { freshStages } from "../app/_components/shared";

test("stream parser handles split UTF-8, split lines and no trailing newline", async () => {
  const events = [{ type: "progress", stage: "assets", status: "active", detail: "Café photos" }, { type: "done", jobId: "test" }];
  const data = new TextEncoder().encode(events.map((e) => JSON.stringify(e)).join("\n"));
  const stream = new ReadableStream<Uint8Array>({ start(c) { for (const byte of data) c.enqueue(new Uint8Array([byte])); c.close(); } });
  const actual = [];
  for await (const e of readRenderEvents(stream)) actual.push(e);
  assert.deepEqual(actual, events);
});

test("only changes to featured photos make the rendered video stale", () => {
  const project = setAdDishes(newProject(), ["a"]);
  const library = ["a", "b"].map((id) => ({ id, title: id, price: "", description: "", imageUrl: `data:image/jpeg;base64,${id}` }));
  const key = renderKey(project, library);
  assert.equal(renderKey(project, [library[0], { ...library[1], imageUrl: "changed" }]), key);
  assert.notEqual(renderKey(project, [{ ...library[0], imageUrl: "data:image/jpeg;base64,z" }, library[1]]), key);
});

test("preview has no video or mock dish image until a real render exists", () => {
  const props = { gen: { phase: "idle" as const }, result: null, dishCount: 2, busy: false, stale: false, onVideoClick() {}, onTime() {}, onAddFiles() {}, onSearch() {}, onRender() {} };
  const html = renderToStaticMarkup(createElement(Preview, props));
  assert.doesNotMatch(html, /<video|<img/);
  assert.match(html, /Your dishes. A fresh take./);
  const loading = renderToStaticMarkup(createElement(Preview, { ...props, gen: { phase: "running", stages: freshStages(), startedAt: 1 } }));
  assert.match(loading, /Generating your video/);
  assert.match(loading, /animate-spin/);
  assert.doesNotMatch(loading, /<video|<img/);
});

test("export downloads the returned MP4, never calls generation, and cleans up", async (t) => {
  let clicked = false;
  let removed = false;
  let revoked = false;
  const requests: string[] = [];
  const anchor = { href: "", download: "", click() { clicked = true; }, remove() { removed = true; } };
  t.mock.method(globalThis, "fetch", async (url: string) => { requests.push(url); return new Response("mp4 bytes", { headers: { "Content-Type": "video/mp4" } }); });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => anchor, body: { appendChild() {} } } });
  t.after(() => Reflect.deleteProperty(globalThis, "document"));
  t.mock.method(URL, "createObjectURL", () => "blob:rendered-video");
  t.mock.method(URL, "revokeObjectURL", () => { revoked = true; });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await downloadRenderedVideo("/api/video/test?download=1");
  assert.deepEqual(requests, ["/api/video/test?download=1"]);
  assert.equal(anchor.download, "plate-studio-ad.mp4");
  assert.ok(clicked && removed);
  t.mock.timers.tick(60_000);
  assert.ok(revoked);
});

test("export surfaces missing videos and invalid responses", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("missing", { status: 404 }));
  await assert.rejects(downloadRenderedVideo("/api/video/missing"), /Click Render/);
  fetch.mock.mockImplementation(async () => new Response("error page", { headers: { "Content-Type": "text/html" } }));
  await assert.rejects(downloadRenderedVideo("/api/video/broken"), /didn't return an MP4/);
});
