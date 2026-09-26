import assert from "node:assert/strict";
import { test } from "node:test";
import { newProject, resolveScenes, setAdDishes, type LibraryDish } from "../lib/ad-plan";
import { clipKey, planShots, type Clip, type Shot } from "../lib/shot-plan";
import { sceneArgs } from "../lib/video-pipeline";
import { servingPrompt, socializingPrompt, stockQueries } from "../lib/shots";

const source = (s: Shot) => s.kind === "clip" ? s.clip.path : s.path;
const fallback = { serving: "serving.jpg", eating: "eating.jpg", socializing: "socializing.jpg" };
function fixture(count: number) {
  const library: LibraryDish[] = Array.from({ length: count }, (_, i) => ({ id: `dish-${i}`, title: `Dish ${i}`, description: "", price: "", imageUrl: `https://example.com/${i}.jpg` }));
  const scenes = resolveScenes(setAdDishes(newProject(), library.map((d) => d.id)), library);
  const stills = new Map(scenes.filter((s) => s.kind === "dish").map((s) => [s.id, `${s.dishId}.jpg`]));
  return { scenes, stills };
}

for (const count of [1, 2, 6]) {
  test(`${count} dishes: fallback images appear once across the entire ad`, () => {
    const { scenes, stills } = fixture(count);
    const plan = planShots(scenes, scenes.map(() => 8), stills, new Map(), true, fallback);
    const files = plan.flat().map(source);
    assert.equal(new Set(files).size, files.length);
    assert.equal(files.length, count + 3);
    assert.deepEqual(plan[0].map(source), [fallback.serving]);
    assert.deepEqual(plan.at(-1)!.map(source), [fallback.socializing]);
    for (const file of stills.values()) assert.equal(files.filter((f) => f === file).length, 1);
  });
}

test("a short dish scene keeps its hero and eating shot ahead of cooking shots", () => {
  const { scenes, stills } = fixture(1);
  const dish = scenes[1];
  const clips = new Map<string, Clip>(["fire", "plating", "hero", "bite"].map((k) => [`${dish.id}:${k}`, { path: `${k}.mp4`, duration: 4 }]));
  const plan = planShots(scenes, [4.5, 3, 6], stills, clips, true, fallback);
  assert.deepEqual(plan[1].map(source), ["hero.mp4", "bite.mp4"]);
  assert.ok(!plan.flat().map(source).includes(stills.get(dish.id)!));
});

test("shared clip paths are never reused and a failed eating shot has a local fallback", () => {
  const { scenes, stills } = fixture(2);
  const clips = new Map<string, Clip>([
    [clipKey(scenes[1].id, "bite"), { path: "bite.mp4", duration: 4 }],
    [clipKey(scenes[0].id, "serving"), { path: "shared.mp4", duration: 4 }],
    [clipKey(scenes.at(-1)!.id, "cheers"), { path: "shared.mp4", duration: 4 }],
  ]);
  const plan = planShots(scenes, [4.5, 6, 6, 6], stills, clips, true, fallback);
  const files = plan.flat().map(source);
  assert.equal(files.length, new Set(files).size);
  assert.ok(files.includes("eating.jpg"));
});

test("lifestyle off uses brand cards and exactly one continuous dish image", () => {
  const { scenes, stills } = fixture(1);
  const plan = planShots(scenes, [5, 30, 6], stills, new Map(), false, fallback);
  assert.equal(plan[0].length, 0);
  assert.equal(plan[1].length, 1);
  assert.equal(plan[2].length, 0);
});

test("renderer never loops clips even when a scene is longer than its footage", () => {
  const { scenes } = fixture(1);
  const args = sceneArgs({ scene: scenes[1], duration: 30, shots: [{ kind: "clip", clip: { path: "hero.mp4", duration: 4 } }], overlays: ["title.png", "tagline.png"], out: "scene.mp4" });
  assert.ok(!args.includes("-stream_loop"));
  assert.equal(args.filter((a) => a === "hero.mp4").length, 1);
});

test("service and social searches respect the venue; eating searches require people", () => {
  assert.match(servingPrompt("Test cafe", "cafe"), /waiter.*coffee and pastries/);
  assert.match(socializingPrompt("Test bar", "bar"), /Friends socializing.*bar over drinks/);
  assert.match(stockQueries("serving", "", "", "cafe")[0].query, /coffee cafe/);
  assert.match(stockQueries("socializing", "", "", "bar")[0].query, /bar drinks/);
  const queries = stockQueries("bite", "Pizza");
  assert.ok(queries.some((q) => q.match.every((re) => re.test("friends eating pizza"))));
  assert.ok(queries.every((q) => !q.match.every((re) => re.test("delicious pizza food on plate"))));
});
