# First 10 Minutes

This guide is for people who just found the repository and want to understand
what the app is before reading the full codebase.

## 1. Run the App

```bash
npm install
npm run electron:dev
```

The Electron app starts a local Vite dev server and opens the desktop shell.
Provider workflows require your own API keys, but you can still inspect the
workspace structure, project flow, and public demo material without committing
credentials.

## 2. Understand the Main Loop

AI Video Production Editor is organized around this production path:

```text
script -> Director -> concepts -> storyboard -> AI filming
       -> continuity review -> re-film queue -> edit -> export
```

The main surfaces to inspect first:

| Surface | Why it matters |
| --- | --- |
| Project Hub | The core script-to-filming production workspace. |
| Node Space | Graph-style workflow and pipeline builder. |
| Image / Video Generation | Provider-facing generation surfaces. |
| Review / Requests | Feedback, QA, and shot task surfaces. |
| Export | Timeline and handoff utilities for downstream work. |

## 3. Use the Demo Project

Open the demo files in `examples/demo-project`:

- `script.md`
- `project-brief.md`
- `shot-list.md`

Create a new project named `Rainline` and paste the script into the Script or
Project Hub script field. The brief and shot list give you continuity anchors
to compare against generated Director/storyboard results.

Suggested first test:

1. Run a Director pass.
2. Apply the Director treatment.
3. Generate concepts for Mira, the memory device, and the neon market street.
4. Generate storyboard frames for shots 1, 3, 5, and 9.
5. Generate one video clip from an approved frame.
6. Run continuity review after rendered shots exist.

## 4. Inspect the Code by Capability

Start with the [Capability Map](CAPABILITY_MAP.md). It links public product
capabilities to code areas, including:

- `src/workspaces/ProjectHubWorkspace.tsx`
- `src/services/studioAgentTaskService.ts`
- `src/services/studioAutomationService.ts`
- `src/services/geminiEmbeddingService.ts`
- `src/workspaces/NodeWorkspace.tsx`
- `src/utils/vfxHandoffManifest.ts`

This is the fastest way to see that the app is a production system, not only a
single prompt form.

## 5. Pick One Useful Contribution

If you want to help, start small:

- improve one setup or workflow doc,
- add screenshots for one workspace,
- fix one provider error message,
- document one Node Space graph,
- add one focused test around a pure utility.

Use [Contributor Paths](CONTRIBUTOR_PATHS.md) to choose a lane.

## 6. What to Avoid

- Do not commit `.env`, `.env.local`, provider keys, certificates, generated
  private media, release builds, or local virtual environments.
- Do not add a provider model unless the inputs, cost behavior, and failure
  modes are understandable to users.
- Do not start with a huge refactor. The app has many production surfaces, so
  small verified changes are easier to review.

## Quick Commands

```bash
npm run build:web
npm test
npm run check:public-release
```

For Electron package builds:

```bash
npm run electron:build
```

Official public installers should be attached to GitHub Releases, not committed
to the repository.
