# Contributor Paths

AI Video Production Editor has a large surface area. This page helps new
contributors pick a useful path without needing to understand the whole app on
day one.

## Path 1: Documentation and Onboarding

Good for writers, technical artists, and early users.

Start here:

- `README.md`
- `docs/FIRST_10_MINUTES.md`
- `docs/ui-production-workflow-guide.md`
- `examples/demo-project`

Useful contributions:

- add screenshots for a workflow,
- document one provider setup path,
- write a Windows or macOS troubleshooting note,
- turn a repeated question into a short guide,
- improve the demo project walkthrough.

Validation:

```bash
npm run check:public-release
```

## Path 2: Provider and Model Adapters

Good for developers who understand API integrations.

Start here:

- `src/services`
- `src/utils/smartModelRouter.ts`
- `src/utils/generationPricing.ts`
- relevant generation workspace in `src/workspaces`

Useful contributions:

- repair a provider request after an API change,
- improve an error message for missing API keys or quota failures,
- add pricing metadata when public pricing is stable,
- add one model option to an existing provider service,
- add tests for request mapping logic where no live API call is needed.

Validation:

```bash
npm run build:web
npm test
```

## Path 3: Script-to-Filming Workflow

Good for AI filmmakers, directors, and product-minded contributors.

Start here:

- `src/workspaces/ProjectHubWorkspace.tsx`
- `src/services/studioAgentTaskService.ts`
- `src/services/studioAutomationService.ts`
- `src/components/StudioAgentStrip.tsx`

Useful contributions:

- improve one step in the project run queue,
- make a blocked state clearer,
- document one end-to-end workflow,
- add a small fixture or demo project note,
- improve the handoff between Director, storyboard, filming, and review.

Validation:

```bash
npm run build:web
```

## Path 4: Continuity and Review

Good for people interested in production QA, story consistency, and AI video
quality control.

Start here:

- `src/services/geminiEmbeddingService.ts`
- `src/services/geminiService.ts`
- `src/workspaces/ReviewWorkspace.tsx`
- `src/workspaces/RequestsWorkspace.tsx`
- `src/types.ts`

Useful contributions:

- improve review summaries,
- add testable continuity scoring helpers,
- clarify re-film queue notes,
- document continuity anchors in demo projects,
- improve review task ergonomics.

Validation:

```bash
npm test
npm run build:web
```

## Path 5: Node Space and Workflow Graphs

Good for people who like visual workflow systems and pipeline design.

Start here:

- `src/workspaces/NodeWorkspace.tsx`
- `docs/CAPABILITY_MAP.md`
- `docs/CONTRIBUTOR_STARTER_TASKS.md`

Useful contributions:

- document one graph template,
- add a small example graph once a stable import/export shape exists,
- improve labels and descriptions,
- add tests around pure metadata helpers.

Validation:

```bash
npm run build:web
```

## Path 6: Export, Editing, and Post

Good for editors, colorists, and post-production developers.

Start here:

- `src/workspaces/ExportWorkspace.tsx`
- `src/utils/openTimelineIOExport.ts`
- `src/utils/openTimelineIOImport.ts`
- `src/utils/fcpxmlExport.ts`
- `src/utils/vfxHandoffManifest.ts`
- `src/utils/vfxScriptExport.ts`

Useful contributions:

- improve export docs,
- add tests for import/export helpers,
- document NLE handoff expectations,
- make relink warnings clearer,
- improve naming and versioning behavior.

Validation:

```bash
npm test
npm run build:web
```

## A Strong First Pull Request

A strong first PR usually:

- changes one focused thing,
- includes before/after screenshots for UI work,
- explains which provider or workflow was tested,
- avoids generated private media and secrets,
- names the checks that passed.

If the change touches a provider API, link the provider documentation used.
