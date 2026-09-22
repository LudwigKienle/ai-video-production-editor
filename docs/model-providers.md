# Model providers and the catalog

## Where a model comes from

| Provider | Auth | Used for |
|---|---|---|
| Google (Gemini / Imagen / Veo) | API key | Script, prompts, Imagen, Nano Banana, Veo |
| Replicate | API key | Flux, Z-Image, Qwen, upscaling, Lyria, Demucs, P-Video |
| fal.ai | API key | Most video models (Kling, Seedance, Wan, LTX, MiniMax, PixVerse, Grok), GPT Image, Seedream, Krea, Ideogram |
| Higgsfield | `KEY_ID:KEY_SECRET` | Soul / Soul Cinema / DoP, and a **second host** for the shared vendor models |
| Midjourney | your account via Jeff (browser agent) | Concept and storyboard images |
| Claude Code / Codex | their own CLI login | Assistant agents |

## The video catalog (`src/services/falVideoCatalog.ts`)

Vendor-namespaced fal endpoints share one request shape (`prompt`, a start-image field,
optional end frame, `duration`, `aspect_ratio`, `resolution`, an audio switch). A catalog
entry declares the paths and exactly which fields the endpoint accepts — fal rejects unknown
fields — and `generateVideoWithFalCatalog` builds the request from it. Adding a fal model is
one entry, not a new function. Field names were checked against fal's model pages
(duration as string for Kling 3 / Hailuo / LTX, `start_image_url` vs `image_url`, resolution enums).

Entries today: Kling 3.0 Standard and 4K, MiniMax H3, Hailuo 2.3, PixVerse 6, LTX 2.5 Pro,
Wan 3.0 and Wan 3.0 Prime. Costs in the pricing table are generated from the same entries.

## Higgsfield as an alternative host (`src/services/higgsfieldService.ts`)

Same queue pattern as fal (`POST /{model}` → `request_id` + `status_url`; poll until
`completed`; the status payload carries `images[]` / `video`). Differences:

- Auth header `Key <id>:<secret>`; create keys at console.higgsfield.ai.
- **Inputs must be uploaded first**: `POST /files/generate-upload-url` → `PUT` to the presigned
  URL → pass `public_url`. No data URIs. The service does this transparently.
- Billing in credits; failed / moderated requests are not charged; outputs kept ≥ 7 days.
- Rate limits are concurrency-based per account and return `400` with a message, no `Retry-After`.
- Their public OpenAPI lists only Soul, Kling 2.5 Turbo and Hailuo 2.3; the rest of the console
  catalog (Soul 2, Soul Cinema, DoP, Kling 3, MiniMax H3, Seedance 2.5, Wan 3, LTX 2.5,
  PixVerse 6) uses the ids seen in the console — marked `verified` only where the spec confirms
  them. If Higgsfield renames an id, only `HIGGSFIELD_VIDEO_PATHS` changes.
- Nothing in their docs restricts third-party apps.

`videoCatalogRouter.ts` picks the host: Settings → Higgsfield → *Video host* (Auto / fal.ai /
Higgsfield). Auto prefers fal when a fal key exists. Higgsfield-only models (DoP, Soul) always go
to Higgsfield.

## Gemini model names

Google renames models (preview suffixes, new generations) and not every key sees every model. Every Gemini client goes through `withModelFallback` (`geminiModelFallback.ts`): on a 404 "model not found" it lists the models the key can use, picks the closest one of the same family (flash / pro / image) and retries once; the substitution is cached for the session and logged as a warning.

## Prompt shaping

Every call passes through `adaptPromptForModel` (`src/services/promptStyle.ts`) — see the
header comment there for the per-family rules. Hailuo/MiniMax models get bracketed camera
commands, Kling short action + separate camera sentences, and so on; Soul is prose.
