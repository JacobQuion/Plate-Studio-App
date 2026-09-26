import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { newProject, resolveScenes, sanitizeLibrary, sanitizeProject, setAdDishes, type LibraryDish } from "../lib/ad-plan";
import { prepareDishImages } from "../lib/image-assets";

const library = (images: string[]): LibraryDish[] => images.map((imageUrl, i) => ({ id: String(i), title: `Dish ${i}`, price: "", description: "", imageUrl }));
const dishes = (images: string[]) => {
  const lib = library(images);
  return resolveScenes(setAdDishes(newProject(), lib.map((d) => d.id)), lib).filter((s) => s.kind === "dish");
};
const uri = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

test("copies with different PNG metadata are rejected before video generation", async () => {
  const original = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#aa5533" } }).png().toBuffer();
  const copy = await sharp(original).withMetadata({ density: 144 }).png().toBuffer();
  assert.notDeepEqual(copy, original);
  await assert.rejects(prepareDishImages(dishes([uri(original), uri(copy)])), /same photo.*Dish 0/);
});

test("unique images decode, while missing and corrupt photos get useful errors", async () => {
  const images = await Promise.all(["red", "blue"].map((background) => sharp({ create: { width: 24, height: 24, channels: 3, background } }).png().toBuffer()));
  assert.equal((await prepareDishImages(dishes(images.map(uri)))).size, 2);
  await assert.rejects(prepareDishImages(dishes([""])), /Add a photo/);
  await assert.rejects(prepareDishImages(dishes([uri(Buffer.from("invalid"))])), /Couldn't load the photo/);
});

test("malformed scene entries and duplicate or path-like IDs cannot collide on disk", () => {
  const p = sanitizeProject({ scenes: [null, 42, { id: "same", kind: "intro" }, { id: "same", kind: "dish", dishId: "dish" }, { id: "../../escape", kind: "outro" }] });
  assert.equal(new Set(p.scenes.map((s) => s.id)).size, 3);
  assert.ok(p.scenes.every((s) => /^[a-zA-Z0-9_-]+$/.test(s.id)));
  assert.equal(sanitizeLibrary([null, 42, ...library(["", ""]).map((d) => ({ ...d, id: "same" }))], 100).length, 1);
});
