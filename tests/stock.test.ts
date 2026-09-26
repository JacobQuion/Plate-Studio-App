import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fetchStockClip } from "../lib/providers/stock";

const videos = [1, 2, 3].map((id) => ({ id, url: `https://www.pexels.com/video/friends-eating-dinner-${id}/`, duration: 8, video_files: [{ file_type: "video/mp4", width: 1920, height: 1080, link: `https://videos.pexels.com/${id}.mp4` }] }));
const queries = [{ query: "friends eating dinner", match: [/friends/, /eating/] }];

test("concurrent stock requests reserve different videos", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plate-stock-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.mock.method(globalThis, "fetch", async (url: string | URL) => String(url).includes("/search?") ? Response.json({ videos }) : new Response(String(url)));
  const used = new Set<number>();
  const paths = [1, 2, 3].map((i) => path.join(dir, `${i}.mp4`));
  await Promise.all(paths.map((file) => fetchStockClip(queries, file, used)));
  const contents = await Promise.all(paths.map((file) => readFile(file, "utf8")));
  assert.equal(new Set(contents).size, 3);
  assert.equal(used.size, 3);
  await assert.rejects(fetchStockClip(queries, path.join(dir, "extra.mp4"), used), /No stock footage/);
});

test("a failed stock download tries another unused candidate", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plate-stock-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let downloads = 0;
  t.mock.method(console, "warn", () => {});
  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    if (String(url).includes("/search?")) return Response.json({ videos });
    downloads++;
    return downloads === 1 ? new Response("Unavailable", { status: 503 }) : new Response("usable clip");
  });
  const file = path.join(dir, "clip.mp4");
  await fetchStockClip(queries, file, new Set());
  assert.equal(downloads, 2);
  assert.equal(await readFile(file, "utf8"), "usable clip");
});
