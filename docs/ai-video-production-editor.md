# AI Video Production Editor — Documentation

## Overview
The AI Video Production Editor helps you plan, generate, and assemble cinematic content using multiple AI providers. It includes storyboarding, timeline editing, auto-cutting, marketing assets, and project collaboration.

## Quick Start
1. Open the Studio and sign in.
2. Go to **Settings → API Keys**.
3. Add keys for the providers you want to use.
4. Create a project and start generating.

## API Keys (All Providers)
Add your API keys in **Settings → API Keys**. You can enable only the providers you need.

### OpenAI
- Used for text prompts and planning.
- Paste the API key in the OpenAI field.

### Replicate
- Used for image/video generation models hosted on Replicate.
- Paste the API key in the Replicate field.

### Google (Gemini)
- Used for vision analysis and advanced reasoning.
- Paste the API key in the Google field.

### xAI (Grok)
- Optional provider for text reasoning or creative prompts.
- Paste the API key in the xAI field.

### Other Providers
If a provider is added later, just paste the key in Settings and restart the app.

## Core Workflows

For annotated screenshots of the current studio UI, see
[`docs/ui-production-workflow-guide.md`](ui-production-workflow-guide.md).

### Storyboard
1. Create a new **Storyboard**.
2. Generate shot ideas from your prompt.
3. Adjust camera style, lens, mood, and lighting presets.
4. Export shots into the timeline.

### Filming / Shot Generation
1. Choose a shot from the storyboard.
2. Select the model and style.
3. Generate variations.
4. Pick a final take and push to timeline.

### Auto Cut
1. Import a long clip into the timeline.
2. Run **Auto Cut** to detect best segments.
3. Review and accept or refine the cut.
4. Export the final edit.

### Marketing Assets
1. Open **Marketing Assets** inside your project.
2. Choose the style and model.
3. Generate posters, thumbnails, or social media visuals.

## Best Practices
- Keep prompts short and visual.
- Use consistent character references for continuity.
- For long clips, let Auto Cut do a first pass, then refine.
- Use multiple providers for different tasks (e.g., Gemini for analysis, Replicate for visuals).

## Troubleshooting
- **Nothing renders**: check your API keys or model selection.
- **Model errors**: ensure the provider supports the chosen model.
- **Slow generation**: reduce resolution or switch providers.

## Support
If you need help, contact:
- Email: luikienle@gmail.com
- Phone: +49 152 36760377
