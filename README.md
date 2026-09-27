# Plate Studio

Turns a restaurant address into a ~30 second 16:9 (1920×1080) ad. Search an address, choose the matching business, and automatically collect menu details and food references. Imported dishes become original AI video scenes using the existing Luma, Replicate, or Google Veo integration. Uploading your own photos remains optional.

The simplest automatic setup is `GEMINI_API_KEY`: it supports Google Search grounding for address/menu research, visual analysis of available food photos, and Veo video generation. Veo needs billing and available quota. Optional `GOOGLE_PLACES_API_KEY` and `YELP_API_KEY` add direct listing details and photo retrieval. With no keys, external Maps/Yelp links still work and uploaded photos can render locally; automatic lookup and original AI footage cannot run.

The browser cannot read a separate Google Maps/Yelp tab. Those buttons open the entered address for reference; research happens on the server after selecting a search result. Public availability varies, and unavailable data produces a clear message instead of sample dishes.

Every image or clip appears once within a video, and footage never loops. For uploaded photos, duplicate decoded images are rejected. Imported restaurant photos are analyzed as references and are not used as video frames or saved in the browser. A generated dish requires a successful AI hero clip; failures surface an error instead of switching to a borrowed-photo slideshow. Generated imagery is an interpretation of the collected dish information, not documentary footage of the restaurant. Photo-derived labels are marked for review, and prices are never inferred from photos.

## Run it

```bash
nvm use              # optional, Node 24 is pinned; Node 22+ supported
npm ci               # ffmpeg-static downloads an FFmpeg binary; no system FFmpeg needed
cp .env.example .env.local   # optional: add API keys
npm run dev          # http://localhost:3000
```

If `.env.local` already exists, keep it and edit only the keys you need. Upload your own photos for a fully local render, or configure a video key for original AI footage. Automatic restaurant research requires network access and a lookup key:

| Stage | Live integration | Fallback |
| --- | --- | --- |
| Restaurant search | Google Places Text Search (`GOOGLE_PLACES_API_KEY`) and/or Yelp (`YELP_API_KEY`) | Source-backed Google Search via the existing Gemini key; otherwise external Maps/Yelp links |
| Restaurant import | Place/Business Details, public website/menu JSON-LD and Yelp menu markup | Gemini searches online menus and identifies visible food in available listing photos; no sample menu is inserted |
| Motion | First configured provider: Luma Dream Machine, Replicate, or Google Veo (`GEMINI_API_KEY`); original imported dishes, animated uploads, and lifestyle clips | Uploaded dishes retain local camera moves; lifestyle clips can use Pexels/bundled images. Imported dish hero clips require AI success |
| Assistant | Claude (`ANTHROPIC_API_KEY`), else Gemini (`GEMINI_API_KEY`) | Rule-based: photos, button text, music and render instructions |
| Voice | ElevenLabs (one line per scene) | macOS `say`, then music only |
| Music | — | Procedural bed synthesized by FFmpeg (`lib/music.ts`), ducked under the voice |

Import and render show percentage progress bars based on completed work. Video generation reaches 100% only when the finished file is available. Keys stay on the server. Integrations: [Google Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search), [Place Photos](https://developers.google.com/maps/documentation/places/web-service/place-photos), [Yelp Business Details](https://docs.developer.yelp.com/reference/v3_business_info), and [Gemini Google Search grounding](https://ai.google.dev/gemini-api/docs/google-search).

Dining and service scenes are on by default, including without keys. The bundled images show guests eating, a waiter serving food, and friends socializing. These are generic AI-generated scenes, not photos of the imported restaurant; [asset details and generation prompts](public/lifestyle/README.md) are included. Each appears at most once, even in a six-dish ad.

Set `PEXELS_API_KEY` for real footage of cooking, dining, servers and friends. Searches favor the menu's setting (restaurant, cafe or bar), eating shots require people, and concurrent requests reserve different stock clips. Pexels also fills in when a lifestyle AI clip fails. With an AI video key, each shot is a separate paid generation: a five-dish ad requests 24 clips (5 dish + 15 cooking/eating + 4 intro/end-card). Short scenes prioritize the dish and eating footage. Ask the assistant for "no lifestyle shots" to use just dish scenes and plain brand cards.

## Checks and troubleshooting

```bash
npm test             # image uniqueness, search, local history, render progress and export
npm run typecheck
npm run build
npm run test:render   # two short offline 1080p MP4s, lifestyle on/off; no paid APIs
```

Next.js's Google Fonts integration downloads fonts during the build, so the first build needs internet access. If Turbopack cannot start a local worker in a restricted environment, use its supported fallback: `npm run dev -- --webpack` or `npm run build -- --webpack`.

If rendering reports a missing or unreadable image, upload a replacement. If it reports duplicate photos, select a different photo for one of the named dishes. A failed stock download tries other unused candidates before falling back locally.

## Using the studio

- **Search restaurant address:** enter a full street address and city in one field; a restaurant name and city also work. Select the correct business to automatically read its details, menu and food references. Up to six dishes are selected for the ad, with source links in Restaurant & dishes. Google Maps and Yelp buttons open the address in another tab. Review any photo-derived food labels before rendering.
- **Upload:** use Photos, drag photos into the assistant, or upload from the library. Photos are immediately available to Render; sending a chat message is optional. Up to six dishes can be featured. Each selected photo must be different.
- **Dishes, locations & history:** select featured dishes, choose the active location, or remove an item. Removal moves it to History, where it can be restored. Removing a location also archives its imported dishes; standalone uploads stay in the library.
- **Local saving:** the project, locations, dish photos and removal history are saved in IndexedDB in this browser, including full uploaded images. Wait for “Saved on this device” before closing the tab. Return using the same browser and site address. Clearing browser site data removes this history; private browsing only retains it for that private session.
- **Assistant:** optionally describe photos or request changes to dish names, prices, brand text, scene length, voiceover and music. Claude or Gemini can interpret these edits when configured. Without a key, the basic assistant supports a smaller set of commands. Chat requests never start a render.
- **Render:** click Render to generate a real MP4. Imported dishes use text-to-video prompts based on menu and visual descriptions; their source photos are never passed as first frames. Your uploads retain image-to-video/local animation. The preview shows a percentage bar while generating. Once complete, play the actual output; click a timeline scene to jump to it. Edits mark the previous render as out of date.
- **Export:** downloads the completed MP4. It becomes available after a successful render and requires rendering again after edits. Export does not generate another video. If a temporary video has expired, click Render again.

## Layout

- `lib/ad-plan.ts` – the ad project model shared by the assistant, editor and renderer: scenes with optional overrides, `resolveScenes()` defaults, `planTimeline()` timing
- `lib/assistant.ts` – Claude / Gemini editing tools and the no-key fallback
- `lib/video-pipeline.ts` – `generateAd()`: assets → motion + voice (parallel) → per-scene renders → xfade join + audio mix; returns scene timings and clickable text boxes
- `lib/shot-plan.ts` – assigns each visual to one continuous shot across the whole video
- `lib/image-assets.ts` – decodes dish photos, rejects duplicate pixels and prepares render assets
- `lib/shots.ts` – prompts and stock queries for cooking, plating, eating, serving, socializing, kitchen and toast shots
- `lib/overlays.ts` – intro, dish lower-third/tagline and end-card layers rendered as PNGs (SVG → sharp), plus where their text landed
- `lib/music.ts` – the procedural music bed
- `lib/menu-import.ts` – Yelp / Google Maps menu import
- `lib/restaurant-import.ts` – listing details, bounded public-menu crawl, photo research and streamed import progress
- `lib/restaurant-research.ts` – Gemini grounded address/menu search and food-photo interpretation
- `lib/render-progress.ts` – weighted progress from completed assets, clips, voice and assembly
- `lib/location-search.ts` – optional Google Places / Yelp search; `lib/locations.ts` – external search links
- `lib/workspace.ts`, `lib/local-workspace.ts` – removal/restoration and persistent local photo/history storage
- `lib/render-client.ts` – streamed progress decoding, render freshness and completed-video downloads
- `lib/providers/video.ts`, `lib/providers/stock.ts`, `lib/providers/voice.ts` – API wrappers
- `app/api/assistant` – chat turn; `app/api/generate` – render (streams NDJSON progress); `app/api/video/[id]` – serves the MP4 with Range support
- `app/page.tsx` + `app/_components/` – the studio UI

Rendered videos are written to `$TMPDIR/plate-studio/<jobId>/final_video.mp4`. These temporary files are not included in browser history; export videos you want to keep. Reopening the studio restores your photos and edits but requires clicking Render to create a new preview.
