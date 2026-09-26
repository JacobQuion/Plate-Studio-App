import assert from "node:assert/strict";
import { test } from "node:test";
import "fake-indexeddb/auto";
import { setAdDishes } from "../lib/ad-plan";
import { activateLocation, archiveDish, archiveLocation, emptyWorkspace, restoreDish, restoreLocation } from "../lib/workspace";
import { loadWorkspace, saveWorkspace } from "../lib/local-workspace";

function fixture() {
  const w = activateLocation(emptyWorkspace(), { id: "loc", name: "Test restaurant", address: "Berkeley, CA", source: "manual", url: "https://www.google.com/maps/search/?api=1&query=test" });
  w.library = [
    { id: "dish", title: "Uploaded dish", price: "$10", description: "My photo", imageUrl: `data:image/png;base64,${"A".repeat(100_000)}`, uploaded: true },
    { id: "menu", title: "Imported dish", price: "$12", description: "", imageUrl: "https://example.com/menu.jpg", locationId: "loc" },
  ];
  w.project = setAdDishes(w.project, ["dish", "menu"]);
  w.project.scenes[1].voice = "A custom narration";
  return w;
}

test("removing and restoring a dish preserves its photo and scene edits", () => {
  const original = fixture();
  const removed = archiveDish(original, "dish", 100);
  assert.equal(removed.library.length, 1);
  assert.ok(!removed.project.scenes.some((s) => s.dishId === "dish"));
  assert.equal(removed.dishHistory[0].removedAt, 100);
  const restored = restoreDish(removed, "dish");
  assert.deepEqual(restored.library.find((d) => d.id === "dish"), original.library[0]);
  assert.equal(restored.project.scenes.find((s) => s.dishId === "dish")?.voice, "A custom narration");
  assert.equal(restored.dishHistory.length, 0);
  assert.equal(restoreDish(restored, "dish").library.length, 2);
});

test("removing a location archives only its imported dishes and restores them", () => {
  const original = fixture();
  const removed = archiveLocation(original, "loc", 200);
  assert.equal(removed.locations.length, 0);
  assert.equal(removed.activeLocationId, null);
  assert.equal(removed.project.restaurant, "");
  assert.deepEqual(removed.library.map((d) => d.id), ["dish"]);
  assert.deepEqual(removed.locationHistory[0].dishIds, ["menu"]);
  const restored = restoreLocation(removed, "loc");
  assert.equal(restored.activeLocationId, "loc");
  assert.equal(restored.project.restaurant, "Test restaurant");
  assert.equal(restored.library.length, 2);
  assert.equal(restored.locationHistory.length, 0);
});

test("IndexedDB survives reopening with active data, deleted history and full images", async () => {
  const w = archiveLocation(archiveDish(fixture(), "dish"), "loc");
  await saveWorkspace(w);
  const loaded = await loadWorkspace();
  assert.deepEqual(loaded, w);
  const restored = restoreLocation(restoreDish(loaded!, "dish"), "loc");
  await saveWorkspace(restored);
  assert.deepEqual(await loadWorkspace(), restored);
});

test("queued local writes preserve the most recent removal", async () => {
  const initial = fixture();
  const last = archiveDish(initial, "dish");
  await Promise.all([saveWorkspace(initial), saveWorkspace(last)]);
  assert.deepEqual(await loadWorkspace(), last);
});
