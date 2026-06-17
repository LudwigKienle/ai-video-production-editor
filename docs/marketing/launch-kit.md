# Launch Kit

This launch kit contains copy, positioning, and visual asset guidance for opening the AI Video Production Editor repository on GitHub and posting the launch on LinkedIn, X, Discord, Reddit, Product Hunt, Hacker News, and creator communities.

Visual assets:

| Asset | Use |
| --- | --- |
| `docs/assets/marketing/github-social-preview.png` | GitHub social preview image and README launch card. |
| `docs/assets/marketing/linkedin-launch-card.png` | LinkedIn landscape post image. |
| `docs/assets/marketing/linkedin-square-card.png` | LinkedIn square post image, Instagram-compatible. |
| `docs/assets/marketing/linkedin-carousel-01.png` | First slide for a workflow carousel. |
| `docs/assets/marketing/ai-launch-background.png` | Imagegen-created abstract source background. |
| `docs/marketing/social-cards.html` | Source template for regenerating the social cards. |

Related launch docs:

- `docs/marketing/visibility-playbook.md`
- `docs/CAPABILITY_MAP.md`
- `docs/FIRST_10_MINUTES.md`
- `docs/CONTRIBUTOR_PATHS.md`
- `examples/demo-project/README.md`
- `docs/releases/v0.1.0-open-source-launch.md`

## Positioning

One-liner:

> AI Video Production Editor is a local-first, open-source desktop studio for planning, generating, editing, reviewing, and exporting AI video projects.

Short description:

> A Blender-inspired AI video production workstation: bring your own provider keys, keep projects local, switch between models, move from script to storyboard to generated shots, then edit and export in one Electron app.

Long description:

> AI Video Production Editor is an open-source desktop studio for AI filmmaking. Instead of locking the workflow behind one provider or one prompt box, it gives creators a production pipeline: project hub, script, concept references, moodboards, image generation, video generation, timeline editing, sound, review, requests, and export. The app is local-first and BYOK, with integrations for Gemini, FAL, Replicate, xAI, ElevenLabs, Sonauto, World Labs, and related production tools.

Repository description:

> Local-first open-source desktop studio for AI video production: script, storyboard, generate, edit, review, and export.

Suggested GitHub topics:

```text
ai-video
video-editor
electron
react
filmmaking
generative-ai
storyboard
text-to-video
image-to-video
byok
local-first
open-source
```

## Primary Launch Message

Core claim:

> AI video should feel like a production studio, not a locked hosted form.

Supporting points:

- Local-first desktop app.
- Bring your own API keys.
- Multi-model production workflows instead of one provider lock-in.
- Script -> Concept -> Storyboard -> Filming -> Edit -> Review -> Export.
- GPT Image, Nano Banana, Seedance 2.0, Kling 3.0 / v3 Pro, Happy Horse 1.0, Gemini, FAL, Replicate, xAI, ElevenLabs, Sonauto, and more.
- Open core so contributors can add model adapters, UI polish, export tools, and production workflows.

Avoid overclaiming:

- Do not imply that every model is free. Provider usage is billed by the provider unless a hosted credit layer is added.
- Do not imply that generated clips are always production-ready. Position the app as a workflow studio that helps iterate and assemble.
- Do not call it a Blender replacement. Say "Blender-inspired open desktop core" instead.

## Launch Model Highlights

Use this framing when someone asks what is new or what models the first public release supports:

| Model family | Launch positioning |
| --- | --- |
| GPT Image | Polished stills, text-aware images, reference frames, and final-quality concept images. |
| Nano Banana | Fast image ideation, photoreal drafts, contextual edits, and quick reference variations. |
| Seedance 2.0 | FAL video generation for storyboard/start-frame control, reference-to-video, and multi-reference motion passes. |
| Kling 3.0 / v3 Pro | FAL text-to-video and image-to-video for high-quality cinematic shots with advanced prompt, audio, element, and end-frame controls. |
| Happy Horse 1.0 | FAL text-to-video and image-to-video when native audio-video generation or a simple prompt-to-clip pass is useful. |

Recommended product story: draft and vary references with Nano Banana, refine important stills with GPT Image, approve storyboard frames, generate controlled clips with Seedance 2.0 or Kling 3.0 / v3 Pro, and use Happy Horse for native audio-video or prompt-only passes.

## LinkedIn Post: Founder Story

```text
I’m opening up AI Video Production Editor on GitHub.

For the last months I built it as a desktop studio for AI filmmaking: script, references, storyboard, image generation, video generation, timeline editing, review, and export in one local workflow.

The reason is simple: AI video should not feel like a locked hosted form.

The direction is closer to a Blender-style open core:

• local-first desktop app
• bring your own provider keys
• multi-model workflows
• script → storyboard → filming → edit → render
• open adapters for fast-moving AI video models

The first public version already supports workflows across Gemini, FAL, Replicate, xAI, ElevenLabs, Sonauto, World Labs, and more. The launch model set includes GPT Image and Nano Banana for image/reference work, plus Seedance 2.0, Kling 3.0 / v3 Pro, and Happy Horse 1.0 through FAL for video generation.

It is not “finished”. That is the point of open sourcing it now.

I’m looking for contributors who care about:

• AI video model adapters
• UX and design polish
• export/render workflows
• sound and post-production tools
• docs and onboarding
• local-first creative software

GitHub: <REPO URL>

If you try it, I’d love honest feedback: where does the workflow feel useful, where is it confusing, and what should become the next core production feature?
```

Recommended image: `docs/assets/marketing/linkedin-launch-card.png`

## LinkedIn Post: Product-Focused

```text
AI Video Production Editor is now open source.

It is a local-first desktop studio for AI video production:

1. Write or import a script
2. Extract characters, locations, props, and references
3. Build a visual direction and storyboard
4. Generate images and clips with models like GPT Image, Nano Banana, Seedance 2.0, Kling 3.0 / v3 Pro, Happy Horse, Veo, WAN, LTX, and Grok
5. Assemble the cut in a timeline
6. Review, fix, and export

The goal is not another one-prompt demo.

The goal is a production workflow creators can own, extend, and run locally with their own provider keys.

GitHub: <REPO URL>

Contributors welcome: model adapters, UI/UX, audio tools, export, docs, and production workflow design.
```

Recommended image: `docs/assets/marketing/linkedin-square-card.png`

## LinkedIn Post: German Version

```text
Ich open-source den AI Video Production Editor auf GitHub.

Die Idee: AI Video sollte sich mehr wie ein echtes Produktionsstudio anfühlen und weniger wie ein einzelnes Prompt-Feld hinter einer Paywall.

Der Editor ist eine lokale Desktop-App für:

• Script und Story Bible
• Moodboards und Referenzen
• Image Generation
• Video Generation
• Timeline Editing
• Sound, Review und Export
• Bring-your-own API Keys

Die Richtung ist bewusst Blender-inspiriert: ein offener Desktop-Core, den die Community erweitern kann.

Aktuell sind u.a. Workflows für Gemini, FAL, Replicate, xAI, ElevenLabs, Sonauto und World Labs enthalten. Für den Launch sind GPT Image und Nano Banana für Bild-/Referenz-Workflows sowie Seedance 2.0, Kling 3.0 / v3 Pro und Happy Horse 1.0 über FAL für Video-Generierung wichtig.

GitHub: <REPO URL>

Ich suche Feedback und Contributors für Model Adapter, UX, Export, Sound, Docs und bessere Production Workflows.
```

Recommended image: `docs/assets/marketing/linkedin-launch-card.png`

## X / Threads Posts

Post 1:

```text
I’m open-sourcing AI Video Production Editor.

A local-first desktop studio for AI filmmaking:
script → references → storyboard → video generation → edit → review → export.

BYOK, multi-model, Electron + React.

GitHub: <REPO URL>
```

Post 2:

```text
AI video tools should feel less like locked hosted forms and more like production software.

That’s why I’m opening the AI Video Production Editor core:

• local-first
• BYOK
• multi-model
• storyboard + filming workflow
• timeline editing + export

<REPO URL>
```

## GitHub README Hero Copy

Use this near the top of the README if you want a stronger launch-style intro:

```md
![AI Video Production Editor launch preview](docs/assets/marketing/github-social-preview.png)

AI Video Production Editor is a local-first, open-source desktop studio for AI filmmaking. Plan a project, write or import a script, generate references and storyboard frames, film shots with multiple AI video models, assemble the timeline, review, and export.
```

## Product Hunt / Launch Directory

Name:

```text
AI Video Production Editor
```

Tagline:

```text
Open-source desktop studio for AI video production.
```

Description:

```text
A local-first Electron app for AI filmmaking. Move from script and references to storyboard, video generation, timeline editing, review, and export with bring-your-own provider keys.
```

First comment:

```text
I built AI Video Production Editor because AI video workflows are still too fragmented: scripts in one tool, references in another, video generation in hosted forms, editing somewhere else, and no clear way to keep continuity.

This project is an attempt to make the workflow feel like production software: local-first, multi-model, and open enough for contributors to add new adapters as the AI video ecosystem changes.

I’d especially love feedback from filmmakers, editors, AI creators, and developers building model integrations.
```

## Hacker News / Reddit Style Post

Title options:

```text
Show HN: AI Video Production Editor – open-source desktop studio for AI filmmaking
Open-source AI video editor with script, storyboard, generation, timeline, review, export
I built a local-first desktop studio for AI video production
```

Body:

```text
I built and open-sourced AI Video Production Editor, a local-first Electron/React app for AI video production.

The workflow is script -> concept references -> storyboard -> video generation -> timeline editing -> review -> export. It supports BYOK provider workflows and adapters for fast-moving AI video/image/audio models.

The goal is not to replace professional NLEs today. The goal is to create an open production workspace around AI video generation, where contributors can add model adapters, better editing workflows, export tools, and local-first project management.

Repo: <REPO URL>

Feedback welcome, especially around architecture, contributor onboarding, and which workflows should be made more robust first.
```

## Launch Checklist

Before posting:

1. Replace `<REPO URL>` everywhere.
2. Set GitHub social preview to `docs/assets/marketing/github-social-preview.png`.
3. Pin a short demo video or GIF in the README if available.
4. Add labels: `good first issue`, `model-adapter`, `docs`, `ux`, `export`, `audio`, `bug`.
5. Open 5 to 10 starter issues for contributors.
6. Confirm `npm run check:public-release` and `npm audit --audit-level=low` pass.
7. Confirm no private media, API keys, local paths, or old brand references appear in screenshots.
8. Post LinkedIn first, then GitHub Discussions/Reddit/Discord/X over the next 24 to 72 hours.

## Regenerating Social Cards

Open or screenshot `docs/marketing/social-cards.html`. The HTML uses factual UI screenshots plus an Imagegen-created abstract background. If text changes, edit the HTML and re-render these selectors:

```text
#github-preview -> docs/assets/marketing/github-social-preview.png
#linkedin-launch -> docs/assets/marketing/linkedin-launch-card.png
#linkedin-square -> docs/assets/marketing/linkedin-square-card.png
#carousel-01 -> docs/assets/marketing/linkedin-carousel-01.png
```
