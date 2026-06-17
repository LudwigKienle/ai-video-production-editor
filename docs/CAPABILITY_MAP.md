# Capability Map

AI Video Production Editor is more than a prompt UI. This page maps the public
source code to the production capabilities that are already present in the
desktop app.

Use it as a quick orientation guide before opening the larger workspaces.

If you are new to the repository, read [First 10 Minutes](FIRST_10_MINUTES.md)
first, then come back here when you want code pointers.

## Core Production Loop

| Capability | What it does | Main code areas |
| --- | --- | --- |
| Project Hub | Central script-to-filming workspace for story, references, Director, storyboard, filming, review, and marketing phases. | `src/workspaces/ProjectHubWorkspace.tsx` |
| Studio Agent tasks | Builds resumable multi-step production runs such as script, concepts, Director pass, storyboard images, and storyboard videos. | `src/services/studioAgentTaskService.ts`, `src/components/StudioAgentStrip.tsx`, `src/hooks/useStudioAgentRuntime.ts` |
| Director pass | Converts script or scene material into a Director treatment and shot plan. | `src/services/geminiService.ts`, `src/workspaces/ProjectHubWorkspace.tsx`, `src/workspaces/ImageGenerationWorkspace.tsx` |
| Scene Wall | Organizes larger scripts into scene-level planning blocks. | `src/workspaces/SceneWallWorkspace.tsx`, `src/workspaces/ProjectHubWorkspace.tsx` |
| Storyboard and filming | Generates storyboard images and video shots from approved project context. | `src/workspaces/ProjectHubWorkspace.tsx`, `src/services/studioAutomationService.ts` |
| Review and requests | Converts review feedback into actionable shot tasks and director requests. | `src/workspaces/ReviewWorkspace.tsx`, `src/workspaces/RequestsWorkspace.tsx` |

## Continuity and Production Memory

| Capability | What it does | Main code areas |
| --- | --- | --- |
| Creative DNA | Keeps director mode, pacing, camera behavior, edit rhythm, lighting intent, and scene/shot overrides consistent. | `src/services/creativeDnaService.ts`, `src/types.ts` |
| Shot context composer | Builds shot context from concepts, world references, and project material. | `src/utils/shotContextComposer.ts` |
| Gemini continuity review | Reviews rendered shots, scores alignment, detects drift, and creates review summaries. | `src/services/geminiEmbeddingService.ts`, `src/types.ts` |
| Continuity refinement | Refines storyboard and filming prompts when continuity issues are detected. | `src/services/geminiService.ts` |
| Usage ledger | Tracks generation usage and cost-related production metadata. | `src/utils/usageTracker.ts`, `src/utils/generationPricing.ts`, `src/types.ts` |

## Model and Provider Layer

| Capability | What it does | Main code areas |
| --- | --- | --- |
| Smart model routing | Scores model candidates by quality, speed, cost, and balanced intent. | `src/utils/smartModelRouter.ts` |
| FAL provider integration | Supports image/video model calls through FAL-style APIs. | `src/services/falAiService.ts` |
| Gemini provider integration | Powers script analysis, Director work, image/text reasoning, continuity and critique flows. | `src/services/geminiService.ts`, `src/services/googleModelProvider.ts` |
| Replicate, xAI, ElevenLabs, Sonauto, LTX | Provider-specific adapters for image, video, audio, and related generation tasks. | `src/services/replicateService.ts`, `src/services/xaiService.ts`, `src/services/elevenLabsService.ts`, `src/services/sonautoService.ts`, `src/services/ltxService.ts` |
| BYOK proxy layer | Optional hosted/key-routing layer for teams or managed deployments. | `src/services/byokProxyClient.ts`, `server/byok`, `api` |

## Workspace Surface

| Workspace | Purpose |
| --- | --- |
| Import | Bring source media and documents into the project. |
| Script | Draft, inspect, and prepare story material. |
| Project Hub | Run the main production pipeline from story to rendered shots. |
| Moodboard, Design, Photo, Outfit, Avatar | Build visual references and production looks. |
| Image Generation, Video Generation | Generate stills and video clips with provider adapters. |
| Node Space | Build graph-style creative pipelines and production chains. |
| Scene Wall, Scene Map, Set Design, World Generation | Plan scenes, spaces, worlds, and set logic. |
| Edit, Trim, Grading, Compositing, Sound | Assemble and polish the production. |
| Review, Requests, Analysis | Run QA, collect feedback, and track director requests. |
| Export | Package timelines, handoff manifests, and final outputs. |

## Export and Handoff

| Capability | What it does | Main code areas |
| --- | --- | --- |
| OpenTimelineIO-style export/import | Timeline interchange helpers. | `src/utils/openTimelineIOExport.ts`, `src/utils/openTimelineIOImport.ts` |
| FCPXML export | Export helper for Final Cut Pro-style workflows. | `src/utils/fcpxmlExport.ts` |
| VFX handoff manifest | Structured manifest for shot handoff, warnings, and downstream comp. | `src/utils/vfxHandoffManifest.ts` |
| Nuke/Natron script export | Generates application scripts from VFX handoff data. | `src/utils/vfxScriptExport.ts`, `src/utils/natronCompositorGraph.ts` |
| OCIO/color utilities | Color and handoff support for grading/export workflows. | `src/utils/openColorIO.ts`, `src/utils/colorGrading.ts`, `src/utils/lut.ts` |

## Contributor Entry Points

| If you want to help with... | Start here |
| --- | --- |
| A provider/model adapter | `src/services`, then open or create a `provider-api` issue. |
| The script-to-filming flow | `src/workspaces/ProjectHubWorkspace.tsx` and `src/services/studioAgentTaskService.ts`. |
| Continuity and review | `src/services/geminiEmbeddingService.ts`, `src/workspaces/ReviewWorkspace.tsx`. |
| Node workflows | `src/workspaces/NodeWorkspace.tsx`. |
| Export and post-production | `src/workspaces/ExportWorkspace.tsx`, `src/utils/*Export.ts`, `src/utils/vfx*`. |
| Docs and onboarding | `README.md`, `docs/ui-production-workflow-guide.md`, `examples/demo-project`. |

## How to Verify Locally

```bash
npm install
npm run electron:dev
```

For source quality checks:

```bash
npm test
npm run build:web
npm run check:public-release
```

Some provider workflows require your own API keys and may change when external
model APIs change.
