# Bring Your Own Key (BYOK) Provider Setup Guide

AI Video Production Editor is a local-first workstation designed around a Bring-Your-Own-Key (BYOK) model. All generation requests are made directly from your machine to the respective AI providers using your own API credentials.

This guide explains where and how to configure your API keys, how each major provider fits into the production pipeline, and critical security and billing best practices.

---

## 1. Where to Enter Your Keys

You have two primary ways to provide API keys:

### Option A: In the Desktop App UI (Recommended)
1. Open the application (Desktop or Web).
2. Click the **Key icon** (or navigate to **Settings → API Keys**) in the sidebar or top navigation bar.
3. Paste your credentials into the corresponding provider fields (e.g. Gemini, Replicate, FAL, xAI, ElevenLabs, Runway, Higgsfield, MachGen).
4. Click **Save Keys**.

> **Where keys are stored:** Keys entered via the UI are stored exclusively in your browser/webview `localStorage` on your local device. They are never sent to any intermediary server or telemetry backend.

### Option B: Local Environment Variables (`.env.local`)
For developers running the editor locally from source:
1. Create a `.env.local` file in the repository root (copied from `.env.example`).
2. Add your provider keys:
   ```bash
   VITE_GEMINI_API_KEY=your_gemini_api_key_here
   # Provider keys for CLI and script tooling:
   ELEVENLABS_API_KEY=your_elevenlabs_key_here
   REPLICATE_API_TOKEN=your_replicate_token_here
   FAL_KEY=your_fal_key_here
   XAI_API_KEY=your_xai_api_key_here
   ```
3. Restart the Vite development server (`npm run dev`).

---

## 2. Supported Providers Overview

| Provider | Getting Your Key | Production Role in Editor |
|---|---|---|
| **Google Gemini** | [Google AI Studio](https://aistudio.google.com/app/apikey) | Script breakdown, director analysis, shot planning, scene continuity review, and native Gemini image/Veo video models. |
| **FAL (fal.ai)** | [fal.ai Dashboard](https://fal.ai/dashboard/keys) | High-speed video generation (Kling, Seedance, Wan, MiniMax, LTX, PixVerse) and state-of-the-art image generation (FLUX.3, GPT Image, Ideogram, Seedream). |
| **Replicate** | [replicate.com/account/api-tokens](https://replicate.com/account/api-tokens) | Image generation (Flux, Qwen, Z-Image), audio separation (Demucs), and upscaling. |
| **xAI (Grok)** | [xAI Console](https://console.x.ai/) | Script assistant, alternative story reasoning, and Grok image/video capabilities. |
| **ElevenLabs** | [elevenlabs.io](https://elevenlabs.io/) | High-fidelity character voiceover, voice cloning, expressive dialogue generation, and cinematic sound effects. |
| **MachGen** | [machgen.ai](https://www.machgen.ai) | Fast, cost-efficient open-weights video and image models (MiniMax H3 Turbo, LTX Pro, Wan). Key format: `MGA_<key_id>:<secret>`. |
| **Higgsfield** | [console.higgsfield.ai](https://console.higgsfield.ai) | Soul Cinema, DoP, and secondary host for shared video vendor models. Key format: `KEY_ID:KEY_SECRET`. |

---

## 3. Important Security & Privacy Notice

> [!WARNING]
> **NEVER commit API keys or `.env.local` to Git.**
> - Keep `.env.local` listed in `.gitignore` at all times.
> - Never paste real API keys into issue reports, pull requests, discussion boards, or Discord/chat channels.
> - If you accidentally commit or expose an API key, revoke and regenerate it immediately in that provider's console.

The application core is open-source (GPL-3.0) and designed to preserve your privacy:
- Your projects, scripts, storyboards, and assets remain as plain files on your local drive.
- Requests to AI services communicate directly from your device to the provider's API endpoints using the keys you configure.

---

## 4. Provider Billing & Costs

> [!IMPORTANT]
> **Provider usage is billed directly by each provider.**
> - AI Video Production Editor is free, open-source software and does **not** charge any usage fees, markups, or subscription fees for BYOK calls.
> - Every generation (generating a script, rendering an image, synthesizing audio, or rendering a video clip) consumes credits or incurs charges directly on your account with that specific provider.
> - Check each provider's dashboard to monitor your spend and establish usage limits or alerts:
>   - [Google Cloud / AI Studio Billing](https://console.cloud.google.com/billing)
>   - [fal.ai Usage & Billing](https://fal.ai/dashboard/billing)
>   - [Replicate Billing](https://replicate.com/account/billing)
>   - [xAI Billing](https://console.x.ai/billing)
>   - [ElevenLabs Subscription & Usage](https://elevenlabs.io/app/subscription)
> - For estimated model generation costs per second/image, consult [`docs/model-pricing-reference.md`](model-pricing-reference.md).
