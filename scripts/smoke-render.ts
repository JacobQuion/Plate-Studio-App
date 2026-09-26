import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import sharp from "sharp";
import { newProject, setAdDishes, type LibraryDish } from "../lib/ad-plan";
import { probeDuration } from "../lib/ffmpeg";
import { generateAd } from "../lib/video-pipeline";

async function main() {
  // A deterministic offline render. Never spend credits during this check.
  for (const key of ["LUMA_API_KEY", "REPLICATE_API_TOKEN", "GEMINI_API_KEY", "PEXELS_API_KEY", "ELEVENLABS_API_KEY"]) delete process.env[key];
  const image = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#986336" } }).jpeg().toBuffer();
  const library: LibraryDish[] = [{ id: "test-dish", title: "Test dish", price: "$12", description: "Freshly made", imageUrl: `data:image/jpeg;base64,${image.toString("base64")}` }];
  for (const lifestyle of [true, false]) {
    const project = setAdDishes({ ...newProject(), restaurant: "Plate Studio", lifestyle }, ["test-dish"]);
    project.scenes = project.scenes.map((s) => ({ ...s, voice: "", duration: 3 }));
    const result = await generateAd(project, library, (event) => console.log(event.stage, event.status, event.detail));
    assert.ok((await stat(result.outputPath)).size > 1000);
    const actual = await probeDuration(result.outputPath);
    assert.ok(actual && Math.abs(actual - result.durationSeconds) < 0.15, `Duration mismatch: ${actual} vs ${result.durationSeconds}`);
    console.log(`PASS lifestyle=${lifestyle}: ${result.outputPath}`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
