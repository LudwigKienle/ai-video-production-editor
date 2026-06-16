# Model Pricing Reference

This document mirrors `api/usage/record.js` billing rates.

- Formula: `bill_rate = provider_rate * 1.02` (2% margin).
- Rounding: charged to cents per usage event (`ceil(total_usd * 100)`).
- Units: image/edit jobs usually use whole units; video uses seconds; audio depends on model call semantics.

## Pricing sources

- Google AI pricing: <https://ai.google.dev/pricing>
- xAI API pricing: <https://x.ai/api>
- FAL model pricing examples:
  - <https://fal.ai/models/fal-ai/kling-video/o3/pro/image-to-video>
  - <https://fal.ai/models/fal-ai/kling-video/o3/pro/reference-to-video>
  - <https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video>
  - <https://fal.ai/models/fal-ai/kling-video/v3/pro/text-to-video>
  - <https://fal.ai/models/fal-ai/creatify/aurora>
  - <https://fal.ai/models/alibaba/happy-horse/text-to-video>
  - <https://fal.ai/models/alibaba/happy-horse/image-to-video>
  - <https://fal.ai/models/fal-ai/qwen-image-max/text-to-image>
  - <https://fal.ai/models/fal-ai/qwen-image-max/edit>
  - <https://fal.ai/models/xai/grok-imagine-video/image-to-video>
- Sonauto developer pricing: <https://sonauto.ai/developers>
- Black Forest Labs pricing (Flux family): <https://bfl.ai/pricing>
- OpenAI image pricing reference (GPT image family): <https://openai.com/api/pricing/>

Some Replicate model pages do not expose machine-readable public list pricing without authenticated access.
Where direct provider list pricing was unavailable, conservative estimates are marked in code comments and labels.

## Hosted plan credits

- `starter`: 800 cents
- `pro`: 2800 cents
- `studio`: 8000 cents

## Per-model rates

| Key | Provider base USD | Billed USD (2% margin) | Fixed base USD | Fixed billed USD |
| --- | ---: | ---: | ---: | ---: |
| `fal:alibaba/happy-horse/image-to-video:video` | 0.280000 | 0.285600 | 0.000000 | 0.000000 |
| `fal:alibaba/happy-horse/text-to-video:video` | 0.280000 | 0.285600 | 0.000000 | 0.000000 |
| `fal:bytedance/seedance-2.0/image-to-video:video` | 0.302400 | 0.308448 | 0.000000 | 0.000000 |
| `fal:bytedance/seedance-2.0/reference-to-video:video` | 0.302400 | 0.308448 | 0.000000 | 0.000000 |
| `fal:fal-ai/creatify/aurora:video` | 0.140000 | 0.142800 | 0.000000 | 0.000000 |
| `fal:fal-ai/kling-video/o3/pro/image-to-video:video` | 0.280000 | 0.285600 | 0.000000 | 0.000000 |
| `fal:fal-ai/kling-video/o3/pro/reference-to-video:video` | 0.280000 | 0.285600 | 0.000000 | 0.000000 |
| `fal:fal-ai/kling-video/v3/pro/image-to-video:video` | 0.336000 | 0.342720 | 0.000000 | 0.000000 |
| `fal:fal-ai/kling-video/v3/pro/text-to-video:video` | 0.336000 | 0.342720 | 0.000000 | 0.000000 |
| `fal:fal-ai/pixverse/c1/reference-to-video:video` | 0.050000 | 0.051000 | 0.000000 | 0.000000 |
| `fal:fal-ai/qwen-image-max/text-to-image:image` | 0.075000 | 0.076500 | 0.000000 | 0.000000 |
| `fal:fal-ai/qwen-image-max/edit:edit` | 0.075000 | 0.076500 | 0.000000 | 0.000000 |
| `fal:xai/grok-imagine-video/image-to-video:video` | 0.050000 | 0.051000 | 0.002000 | 0.002040 |
| `gemini:gemini-2.5-flash-image:image` | 0.039000 | 0.039780 | 0.000000 | 0.000000 |
| `gemini:gemini-2.5-flash-preview-tts:audio` | 0.020000 | 0.020400 | 0.000000 | 0.000000 |
| `gemini:gemini-3-pro-image-preview:image` | 0.134000 | 0.136680 | 0.000000 | 0.000000 |
| `gemini:imagen-4.0-generate-001:image` | 0.040000 | 0.040800 | 0.000000 | 0.000000 |
| `gemini:veo-3.1-fast-generate-preview:video` | 0.150000 | 0.153000 | 0.000000 | 0.000000 |
| `gemini:veo-3.1-generate-preview:video` | 0.400000 | 0.408000 | 0.000000 | 0.000000 |
| `replicate:aiunivers/openpose:image` | 0.009000 | 0.009180 | 0.000000 | 0.000000 |
| `replicate:black-forest-labs/flux-1.1-pro:image` | 0.040000 | 0.040800 | 0.000000 | 0.000000 |
| `replicate:black-forest-labs/flux-2-klein-9b-base:image` | 0.015000 | 0.015300 | 0.000000 | 0.000000 |
| `replicate:black-forest-labs/flux-2-pro:edit` | 0.045000 | 0.045900 | 0.000000 | 0.000000 |
| `replicate:black-forest-labs/flux-fill-dev:edit` | 0.050000 | 0.051000 | 0.000000 | 0.000000 |
| `replicate:black-forest-labs/flux-schnell:image` | 0.003000 | 0.003060 | 0.000000 | 0.000000 |
| `replicate:bytedance/omni-human:video` | 0.160000 | 0.163200 | 0.000000 | 0.000000 |
| `replicate:bytedance/seedance-1.5-pro:video` | 0.052000 | 0.053040 | 0.000000 | 0.000000 |
| `replicate:bytedance/seedream-4.5:image` | 0.040000 | 0.040800 | 0.000000 | 0.000000 |
| `replicate:cjwbw/rembg:image` | 0.008000 | 0.008160 | 0.000000 | 0.000000 |
| `replicate:facebookresearch/demucs:audio` | 0.009000 | 0.009180 | 0.000000 | 0.000000 |
| `replicate:google/gemini-3-pro:image` | 0.134000 | 0.136680 | 0.000000 | 0.000000 |
| `replicate:google/lyria-2:audio` | 0.030000 | 0.030600 | 0.000000 | 0.000000 |
| `replicate:google/nano-banana-pro:edit` | 0.150000 | 0.153000 | 0.000000 | 0.000000 |
| `replicate:google/nano-banana-pro:image` | 0.150000 | 0.153000 | 0.000000 | 0.000000 |
| `replicate:google/veo-3.1-fast:video` | 0.150000 | 0.153000 | 0.000000 | 0.000000 |
| `replicate:google/veo-3.1:video` | 0.400000 | 0.408000 | 0.000000 | 0.000000 |
| `replicate:hyper3d/rodin:image` | 0.600000 | 0.612000 | 0.000000 | 0.000000 |
| `replicate:intel-isl/midas:image` | 0.010000 | 0.010200 | 0.000000 | 0.000000 |
| `replicate:isl-org/dpt:image` | 0.010000 | 0.010200 | 0.000000 | 0.000000 |
| `replicate:jagilley/controlnet-normal:image` | 0.015000 | 0.015300 | 0.000000 | 0.000000 |
| `replicate:jagilley/controlnet-scribble:image` | 0.015000 | 0.015300 | 0.000000 | 0.000000 |
| `replicate:jagilley/controlnet:image` | 0.015000 | 0.015300 | 0.000000 | 0.000000 |
| `replicate:kwaivgi/kling-v2.5-turbo-pro:video` | 0.070000 | 0.071400 | 0.000000 | 0.000000 |
| `replicate:kwaivgi/kling-v2.6-motion-control:video` | 0.180000 | 0.183600 | 0.000000 | 0.000000 |
| `replicate:kwaivgi/kling-v2.6:video` | 0.140000 | 0.142800 | 0.000000 | 0.000000 |
| `replicate:lightricks/ltx-2-fast:video` | 0.040000 | 0.040800 | 0.000000 | 0.000000 |
| `replicate:minimax/speech-02-hd:audio` | 0.020000 | 0.020400 | 0.000000 | 0.000000 |
| `replicate:nightmareai/real-esrgan:edit` | 0.015000 | 0.015300 | 0.000000 | 0.000000 |
| `replicate:openai/gpt-image-1.5:image` | 0.042000 | 0.042840 | 0.000000 | 0.000000 |
| `replicate:philz1337x/clarity-upscaler:edit` | 0.020000 | 0.020400 | 0.000000 | 0.000000 |
| `replicate:philz1337x/crystal-upscaler:edit` | 0.020000 | 0.020400 | 0.000000 | 0.000000 |
| `replicate:philz1337x/crystal-video-upscaler:edit` | 0.030000 | 0.030600 | 0.000000 | 0.000000 |
| `replicate:prunaai/flux-2-turbo:image` | 0.020000 | 0.020400 | 0.000000 | 0.000000 |
| `replicate:prunaai/z-image-turbo-img2img:image` | 0.005000 | 0.005100 | 0.000000 | 0.000000 |
| `replicate:prunaai/z-image-turbo-inpaint:edit` | 0.005000 | 0.005100 | 0.000000 | 0.000000 |
| `replicate:prunaai/z-image-turbo:image` | 0.004000 | 0.004080 | 0.000000 | 0.000000 |
| `replicate:prunaai/z-image:image` | 0.006000 | 0.006120 | 0.000000 | 0.000000 |
| `replicate:qwen/qwen-edit-multiangle:edit` | 0.035000 | 0.035700 | 0.000000 | 0.000000 |
| `replicate:qwen/qwen-image-2512:image` | 0.020000 | 0.020400 | 0.000000 | 0.000000 |
| `replicate:qwen/qwen-image-edit-2511:edit` | 0.020000 | 0.020400 | 0.000000 | 0.000000 |
| `replicate:runwayml/gen4-image-turbo:image` | 0.050000 | 0.051000 | 0.000000 | 0.000000 |
| `replicate:sczhou/restoreformer:image` | 0.010000 | 0.010200 | 0.000000 | 0.000000 |
| `replicate:sczhou/rife:video` | 0.040000 | 0.040800 | 0.000000 | 0.000000 |
| `replicate:tencentarc/gfpgan:image` | 0.010000 | 0.010200 | 0.000000 | 0.000000 |
| `replicate:topazlabs/image-upscale:edit` | 0.060000 | 0.061200 | 0.000000 | 0.000000 |
| `replicate:topazlabs/video-upscale:edit` | 0.080000 | 0.081600 | 0.000000 | 0.000000 |
| `sonauto:v3-preview:audio` | 0.060000 | 0.061200 | 0.000000 | 0.000000 |
| `replicate:wan-video/wan-2.2-animate-replace:video` | 0.050000 | 0.051000 | 0.000000 | 0.000000 |
| `replicate:wan-video/wan-2.2-i2v-fast:video` | 0.050000 | 0.051000 | 0.000000 | 0.000000 |
| `xai:grok-2-image:image` | 0.070000 | 0.071400 | 0.000000 | 0.000000 |
| `xai:grok-imagine-video:video` | 0.050000 | 0.051000 | 0.000000 | 0.000000 |

## Fallback rates (for unknown models)

- `image`: base 0.040000 USD, billed 0.040800 USD
- `edit`: base 0.030000 USD, billed 0.030600 USD
- `video`: base 0.080000 USD, billed 0.081600 USD
- `audio`: base 0.030000 USD, billed 0.030600 USD
