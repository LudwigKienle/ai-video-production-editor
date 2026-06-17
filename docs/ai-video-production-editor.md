# AI Video Production Editor Documentation

## Overview

AI Video Production Editor is a local-first, open-source AI film production
workspace. It helps creators move from script and references to Director
treatment, storyboard, AI filming, continuity review, timeline editing, review,
and export.

For the fastest repository orientation, start with:

- [First 10 Minutes](FIRST_10_MINUTES.md)
- [Capability Map](CAPABILITY_MAP.md)
- [Demo Project](../examples/demo-project/README.md)

## Quick Start

```bash
npm install
npm run electron:dev
```

Then create a local project and add provider keys only for the models you want
to use.

## API Keys (All Providers)

Add your API keys in **Settings -> API Keys**. You can enable only the providers
you need. Provider usage is billed by the provider unless you run your own
hosted credit/proxy layer.

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

### Script to Filming

1. Create or import a script.
2. Run a Director pass.
3. Apply the Director treatment.
4. Generate concepts and storyboard frames.
5. Generate filming clips from approved frames.
6. Run continuity review after rendered shots exist.
7. Move drift/watch shots into the re-film queue.

### Node Space

1. Open Node Space.
2. Choose or build a graph-style workflow.
3. Route prompts, references, providers, and handoff steps through the graph.
4. Use graph runs to inspect pipeline behavior.

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
- Use multiple providers for different tasks, such as Gemini for analysis and a
  dedicated media provider for visuals.
- Keep provider credentials local and never commit `.env.local`.

## Troubleshooting

- **Nothing renders**: check your API keys or model selection.
- **Model errors**: ensure the provider supports the chosen model.
- **Slow generation**: reduce resolution or switch providers.
- **Install or launch problems**: open a GitHub issue with OS, Node version,
  command, and full error text.

## Support

- Bugs and provider API changes:
  <https://github.com/LudwigKienle/ai-video-production-editor/issues>
- Security issues: follow [SECURITY.md](../SECURITY.md) instead of opening a
  public issue.
- Tutorials: <https://www.youtube.com/@AIVideoProductionEditor>
