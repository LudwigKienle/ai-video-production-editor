# Local AI

The **Local AI** workspace (sidebar → Project → Local AI) runs models on your own
computer. Nothing is billed, prompts and images stay on the machine, and it works
offline once the models are downloaded.

## Text models (local LLMs)

1. Install [Ollama](https://ollama.com/download) and open it. LM Studio (Developer → Start
   server) and any OpenAI-compatible server work too.
2. Local AI → Text models: the server shows as running. Press **Download** on a model;
   Qwen 3.5 9B is a good default for 16 GB of RAM, Qwen 3.5 4B or Gemma 4 4B for 8 GB.
3. Pick the model and choose how to use it:
   - **Local model for all text steps**: script writing, script analysis, shot lists,
     prompts and the assistant all run locally, even with a Gemini key set.
   - **Gemini, local only without a key**: the local model takes over only when no
     Gemini key is set.

How it works: the text features call Gemini's `generateContent`. `localLlmService`
answers those calls from the local server's `/v1/chat/completions` instead, translating
the system instruction, history, function declarations (assistant tools) and JSON
schemas. Requests that generate or read images, video or audio still go to Gemini;
reference images are sent to the local model when it can read images (models marked
"vision").

## Image and video models (ComfyUI)

1. Install [ComfyUI Desktop](https://www.comfy.org/download) (or run ComfyUI yourself) and
   keep it running. Update it: the newest models need recent ComfyUI versions.
2. Local AI → Image & video models: choose ComfyUI's `models` folder (ComfyUI Desktop:
   `Documents/ComfyUI/models`).
3. Press **Download** on a model. Downloads resume after an interruption; the files go
   into the right subfolders (`diffusion_models`, `text_encoders`, `vae`, …).
4. Pick the model in **Images** or **Video**. With a reference image an image model edits
   it and a video model starts from it; without one they work from the prompt.

| Model | Kind | Download | GPU | License |
| --- | --- | --- | --- | --- |
| FLUX.3 Klein | image, edit | 11 GB (+6.7 GB enhancer) | 12 GB+ | FLUX Kommunity: commercial use limited; gated (HF token) |
| Qwen Image 2.1 | image, edit, transparency | 17 GB (+enhancers) | 16 GB+ | Qwen Research: non-commercial |
| Qwen Image 2.1 Turbo | image, edit (8 steps) | 17 GB | 16 GB+ | Qwen Research: non-commercial |
| Z-Image Turbo | image (8 steps) | 12 GB | 8 GB+ | Apache 2.0 |
| FLUX.2 Klein 4B | image, edit (4 steps) | 12 GB | 8 GB+ | Apache 2.0 |
| Wan 2.2 5B | text/image to video | 18 GB | 12–16 GB | Apache 2.0 |
| LTX-2.3 | text/image to video with audio | 43 GB | 24 GB + 64 GB RAM | LTX-2 Community: free under USD 10M revenue |
| LTX-2.5 | text/image to video with audio | 45 GB | 24 GB + 64 GB RAM | LTX-2.x Community: free under USD 10M revenue; gated |

**Gated models** (FLUX.3 Klein, LTX-2.5) need a Hugging Face read token: accept the
license once on the model's Hugging Face page, create a token at
huggingface.co/settings/tokens and paste it in Local AI. The token is only sent to
huggingface.co.

**Prompt enhancers.** FLUX.3 Klein and Qwen Image 2.1 ship an optional LLM that expands a
short prompt into the detailed caption the model is trained on. Tick "Also download
the prompt enhancer"; without it the prompt is used as typed.

How it works: `src/data/localModelCatalog.generated.json` holds each model's files (names
and exact sizes checked against the Hugging Face file trees) and the official Comfy-Org
workflow templates converted to ComfyUI's API format, with bindings for prompt, size,
seed, length and reference images. All workflow variants pass ComfyUI's own prompt
validation and use no custom nodes. `localModelService` downloads through the desktop
app (`electron/local-ai.js`), fills a workflow and queues it in ComfyUI.

## Draw Things (Mac, iPad)

[Draw Things](https://drawthings.ai) runs image models natively on Apple silicon. Download
a model inside Draw Things, turn on Settings → API Server (HTTP, port 7860), then pick
**Draw Things** in Images. The model is whichever one is loaded in Draw Things; a reference
image is used as the start image.

## Cloud models added alongside

FLUX.3 (text-to-image, multi-reference edit, Klein, and video with native audio) and
Krea 3 (text-to-image and reference edit) are available through fal.ai with a fal key.
Qwen Image 2.1 has no cloud API (its license is non-commercial); it runs locally only.
