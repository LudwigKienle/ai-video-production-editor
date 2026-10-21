# Bring Your Own Key (BYOK) Provider Setup Guide

AI Video Production Editor is built around a Bring-Your-Own-Key (BYOK) model. All generation requests are made directly from your machine to the respective AI providers using your own API credentials.

This guide explains where and how to configure your API keys, how supported providers fit into the production workflow, and important security and billing details.

---

## 1. Where to Enter Your Keys

### Option A: In the Application Settings (All Providers)
1. Open the application (Desktop or Web).
2. Go to **Settings → AI providers** in the sidebar.
3. Paste your credentials into the corresponding provider fields (Gemini, FAL, Replicate, xAI, ElevenLabs, Runway, LTX, World Labs, Sonauto, Sonilo, MachGen, Higgsfield, Brave Search, Unsplash).
4. Click **Save**.

> **Where keys are stored:** Keys entered locally in the UI are stored exclusively in your browser/webview `localStorage` on your local device. When using direct BYOK keys, requests communicate directly with each provider without passing through any intermediary server. (In the web version configured with team keys, requests route through `/api/byok/proxy` as described in [`docs/model-pricing-reference.md`](model-pricing-reference.md)).

### Option B: Local Environment Variable (`.env.local`)
For developers running the editor locally from source:
1. Create a `.env.local` file in the repository root (copied from `.env.example`).
2. The application reads `VITE_GEMINI_API_KEY` for the built-in documentation support chat:
   ```bash
   VITE_GEMINI_API_KEY=your_gemini_api_key_here
   ```
3. Restart the Vite development server (`npm run dev`).

> **Note:** `VITE_GEMINI_API_KEY` is the only provider key read from `.env.local`. All other provider keys (FAL, Replicate, xAI, ElevenLabs, etc.) are entered directly in the app under **Settings → AI providers**.

---

## 2. Supported Providers Overview

For a comprehensive matrix of supported models and features, see [`docs/model-providers.md`](model-providers.md).

| Provider | Getting Your Key | Production Role in Editor |
|---|---|---|
| **Google Gemini** | [Google AI Studio](https://aistudio.google.com/app/apikey) | Script breakdown, director analysis, shot planning, scene continuity review, and native Gemini image/Veo video models. |
| **FAL (fal.ai)** | [fal.ai Dashboard](https://fal.ai/dashboard/api-keys) | High-speed video generation (Kling, Seedance, Wan, MiniMax, LTX, PixVerse) and image generation (FLUX.3, GPT Image, Ideogram, Seedream). |
| **Replicate** | [replicate.com/account/api-tokens](https://replicate.com/account/api-tokens) | Image generation (Flux, Qwen, Z-Image), audio separation (Demucs), and upscaling. |
| **xAI (Grok)** | [xAI Console](https://console.x.ai/) | Grok image and video generation. |
| **ElevenLabs** | [elevenlabs.io](https://elevenlabs.io/) | Voiceover (text to speech with your custom voice list). |
| **Runway** | [Runway Developer Portal](https://dev.runwayml.com/) | Gen-3 Alpha and Gen-3 Turbo video generation. |
| **LTX** | [Lightricks LTX](https://ltx.video) | LTX Video models. |
| **World Labs** | [World Labs](https://worldlabs.ai) | Spatial and 3D world representations. |
| **Sonauto & Sonilo** | Provider consoles | Background music and soundtrack generation. |
| **MachGen** | [machgen.ai](https://www.machgen.ai) | Fast open-weights video and image models (MiniMax H3 Turbo, LTX Pro, Wan). Key format: `MGA_<key_id>:<secret>`. |
| **Higgsfield** | [console.higgsfield.ai](https://console.higgsfield.ai) | Soul Cinema, DoP, and secondary host for shared video vendor models. Key format: `KEY_ID:KEY_SECRET`. |
| **Brave Search & Unsplash** | Developer portals | Web research and stock reference photography. |

### Keyless Local AI Options
Prefer running locally without external API keys or recurring costs? The editor also supports local models via:
- **Ollama / LM Studio** for local LLM scriptwriting and analysis
- **ComfyUI** for local image and video workflows
- **Draw Things** for macOS Apple Silicon acceleration

Refer to [`docs/local-ai.md`](local-ai.md) for full setup instructions.

---

## 3. Important Security & Privacy Notice

> [!WARNING]
> **NEVER commit API keys or `.env.local` to Git.**
> - Keep `.env.local` listed in `.gitignore` at all times.
> - Never paste real API keys into issue reports, pull requests, discussion boards, or Discord/chat channels.
> - If you accidentally commit or expose an API key, revoke and regenerate it immediately in that provider's console.

The application core is open-source (GPL-3.0) and designed to preserve your privacy:
- Your projects, scripts, storyboards, and assets remain as plain files on your local drive.
- For local BYOK keys, requests communicate directly from your device to the provider's API endpoints using the keys you configure.

---

## 4. Provider Billing & Costs

> [!IMPORTANT]
> **Provider usage is billed directly by each provider for BYOK.**
> - When using your own keys (BYOK), the open-source editor does **not** charge any usage fees, markups, or subscription fees.
> - Every generation (generating a script, rendering an image, synthesizing audio, or rendering a video clip) consumes credits or incurs charges directly on your account with that specific provider.
> - (Note: The hosted web version with managed team keys applies a 2% margin on raw usage as documented in [`docs/model-pricing-reference.md`](model-pricing-reference.md)).
> - Check each provider's dashboard to monitor your spend and establish usage limits or alerts:
>   - [Google Cloud / AI Studio Billing](https://console.cloud.google.com/billing)
>   - [fal.ai Usage & Billing](https://fal.ai/dashboard/billing)
>   - [Replicate Billing](https://replicate.com/account/billing)
>   - [xAI Billing](https://console.x.ai/billing)
>   - [ElevenLabs Subscription & Usage](https://elevenlabs.io/app/subscription)
> - For estimated model generation costs per second/image, consult [`docs/model-pricing-reference.md`](model-pricing-reference.md).
