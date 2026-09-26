# Plate Studio

Turns restaurant dish photos into ~30 second 16:9 (1920×1080) YouTube ads: an intro montage that opens in the kitchen, one scene per dish (up to 6) that cuts from dramatic cooking (flames, sizzle) to plating to the dish itself to someone taking the first bite, and an end card with your call to action over friends toasting, all voiced, scored and given a warm film grade.

## Run it

```bash
npm install          # ffmpeg-static downloads an FFmpeg binary; no system FFmpeg needed
cp .env.example .env.local   # optional: add API keys
npm run dev          # http://localhost:3000
```

Every API key is optional. Without keys (or when an API errors or rate-limits), each stage falls back locally so the demo always renders a video:

| Stage | Live integration | Fallback |
| --- | --- | --- |
| Menu import | JSON-LD / Yelp menu markup | Curated sample menu matched to the cuisine |
| Motion | Luma Dream Machine, then Replicate, then Google Veo (`GEMINI_API_KEY`): each dish photo animated, plus text-to-video fire, plating and first-bite shots (3 per dish, plus 1 for the intro and 1 for the end card) | Pexels stock footage (free key) for the fire, plating, first-bite, kitchen and toast shots; then FFmpeg camera moves on the dish photos: push-in, pull-out, pans, tilt, close-up drift (no cooking or people shots without a key) |
| Assistant | Claude (`ANTHROPIC_API_KEY`), else Gemini (`GEMINI_API_KEY`) | Rule-based: links, photos, button text, music, render |
| Voice | ElevenLabs (one line per scene) | macOS `say`, then music only |
| Music | — | Procedural bed synthesized by FFmpeg (`lib/music.ts`), ducked under the voice |

The top bar pills show which integrations are live vs. on fallback.

The cooking and diner shots are on by default whenever a video key is set. The cheapest way to get them is a free `PEXELS_API_KEY`: real footage of flames, plating and people eating, searched by the kind of dish ("pizza cooking fire", "people eating pizza"). With an AI key too, Pexels fills in for any AI shot that fails. Each one is a separate paid generation, so a 5-dish ad makes 22 clips (5 dish + 15 cooking/eating + 2 intro/end card). Ask the assistant for "no cooking or diner shots" to turn them off.

## Using the studio

- **Assistant (left):** paste a Yelp or Google Maps link, drop in dish photos, or give feedback ("make it punchier", "drop the dessert", "longer pizza scene"). With `ANTHROPIC_API_KEY` set, Claude (`claude-opus-5`) edits the ad through tools and looks at uploaded photos to name and describe them. With only `GEMINI_API_KEY`, Gemini (`GEMINI_CHAT_MODEL`, default `gemini-flash-latest`) does the same with the same tools. Without a key, a basic assistant handles links, photos, the button text, music and "render".
- **Preview:** click any text in the frame to edit it. Before a render (or when there are unrendered edits) it shows a live HTML mock of the selected scene; after a render, pause the video and click its text.
- **Timeline + scene editor (below the video):** click a scene to jump there. Edit the name, price, tagline, button, website, voiceover line, length, camera style and transition. Add, reorder or remove dish scenes.

## Layout

- `lib/ad-plan.ts` – the ad project model shared by the assistant, editor and renderer: scenes with optional overrides, `resolveScenes()` defaults, `planTimeline()` timing
- `lib/assistant.ts` – Claude / Gemini tool loop (import_menu, set_brand, set_ad_dishes, update_dish, update_scene, render_video, suggest_replies) and the no-key fallback
- `lib/video-pipeline.ts` – `generateAd()`: assets → motion + voice (parallel) → per-scene renders → xfade join + audio mix; returns scene timings and clickable text boxes
- `lib/shots.ts` – prompts for the AI fire, plating, first-bite, kitchen and toast shots (actions are matched to the kind of dish)
- `lib/overlays.ts` – intro, dish lower-third/tagline and end-card layers rendered as PNGs (SVG → sharp), plus where their text landed
- `lib/music.ts` – the procedural music bed
- `lib/menu-import.ts` – Yelp / Google Maps menu import
- `lib/providers/video.ts`, `lib/providers/stock.ts`, `lib/providers/voice.ts` – API wrappers
- `app/api/assistant` – chat turn; `app/api/generate` – render (streams NDJSON progress); `app/api/video/[id]` – serves the MP4 with Range support
- `app/page.tsx` + `app/_components/` – the studio UI

Rendered videos are written to `$TMPDIR/plate-studio/<jobId>/final_video.mp4`.
