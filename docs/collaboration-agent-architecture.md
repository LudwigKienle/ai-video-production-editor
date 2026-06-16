# Collaboration and Studio Agent Architecture

## Why this direction

The editor already has:

- project collaborator metadata, chat threads, meeting links, and storage links
- cloud file sync for Dropbox and Google Drive
- local edit-agent and director-agent flows

What it does not have yet is:

- true multi-user realtime editing
- presence and typed operations across machines
- a reliable in-app action layer for an autonomous agent

That makes the current system collaborative in metadata, but not yet collaborative in execution.

## Recommended target architecture

### 1. Realtime collaboration

Use a dual model instead of one monolithic sync path:

- Realtime state sync for active sessions
- Durable file sync for project assets and recovery

Recommended stack:

- `Yjs` as the conflict-free shared document model for timeline, storyboard, notes, and shot metadata
- `Hocuspocus` as the Yjs collaboration backend when you want a dedicated CRDT server
- `Supabase Realtime` for presence, lightweight events, locks, and notifications
- existing Dropbox / Google Drive sync only as project-package backup and asset transport

Why:

- Yjs is purpose-built for collaborative apps and automatically merges concurrent updates.
- Hocuspocus is already designed as a collaboration backend for Yjs.
- Supabase Realtime is a good fit for presence, activity pings, handoff events, and review notifications without forcing every change through file polling.

### 2. File and asset sync

Do not treat `project.json` as the primary concurrency primitive once multiple people are live in the same edit.

Instead:

- keep CRDT state for timeline, storyboard, review comments, shot metadata, and collaboration metadata
- store generated assets in object storage or project assets folders
- persist content-addressed asset manifests in project metadata
- use background upload / download workers for media files
- keep Drive / Dropbox export mirrors for teams that still want filesystem visibility

### 3. Presence and locking

Presence should be soft, not blocking, except for destructive surfaces.

Use:

- soft presence for workspace, phase, shot, and selected clip
- short-lived locks for export, batch storyboard apply, and destructive bulk rewrite
- optimistic editing for most text and timeline operations

### 4. Agent execution model

Do not build the main agent around pixel-clicking first.

Reliable order of operations:

1. Internal action API
2. DOM / component level automation
3. Native desktop control only as fallback

The app should expose typed capabilities such as:

- navigate workspace
- set project phase
- select clip
- generate edit plan
- apply edit plan
- run director pass
- generate shot image
- generate shot video
- export storyboard / timeline

This is much more stable than asking an agent to discover and click arbitrary buttons every time.

### 5. Self-improving execution loop

Use a closed loop:

1. Observe app state
2. Plan next action
3. Execute one typed action
4. Re-observe
5. Score result
6. Continue or stop

The key is that "verify" must read first-class app state, not only screenshots.

Good verification signals:

- active workspace and phase
- selected clip / shot
- generation job state
- diff preview availability
- render/export completion
- review findings
- asset count changes

## How this maps to the current repo

### Existing pieces to build on

- `src/types.ts` already contains collaboration and sync metadata.
- `src/services/cloudSyncService.ts` already handles Dropbox / Drive file sync.
- `src/components/EditorAgentPanel.tsx` already demonstrates a plan -> preview -> apply edit-agent flow.
- `src/services/editorAgentService.ts` already produces structured operations instead of raw UI gestures.

### New foundation added in this slice

- `src/services/realtimeCollaborationService.ts` gives the app a Supabase Realtime session layer for presence, typed events, and lightweight locks.
- `src/services/studioAutomationService.ts` defines the internal capability catalog the future Studio Agent should use before any native UI automation.

## External architecture references

Useful patterns to study in external agent systems:

- Remote session lifecycle.
- Authenticated bridge transport.
- Environment and session registration.
- Long-lived remote session orchestration.
- Permission requests and responses.
- Reconnect semantics.
- Recurring observe -> act -> verify execution pattern.

What to copy conceptually:

- session manager
- explicit permission boundaries
- resumable remote runs
- looped execution with verification

What not to copy literally:

- terminal-first assumptions
- tool contracts that depend on shell-only workflows

## OSS components worth integrating

### Realtime collaboration

- Yjs: CRDT engine for shared state
- Hocuspocus: hosted or self-hosted Yjs backend
- Supabase Realtime: presence, broadcast, notifications, lightweight locks

### Agent control

- Playwright: deterministic DOM and Electron-webview level control
- Stagehand: natural-language browser automation when you need agentic navigation with stronger repeatability than raw prompt-click loops
- nut.js: native keyboard, mouse, window, OCR, and image-based automation for Electron shell fallbacks
- OpenAdapt: demonstration capture, evaluation, and desktop agent benchmarking if you later want to learn from expert demonstrations

## Practical rollout plan

### Phase 1

- Introduce realtime presence and typed broadcast events
- Add agent capability registry
- Add human review boundaries around high-risk agent actions

### Phase 2

- Move storyboard, review comments, and project notes to shared CRDT documents
- Add asset upload jobs and remote presence UI
- Add lock manager for export and destructive batch actions

### Phase 3

- Add Studio Agent session runtime with observe -> plan -> act -> verify loop
- Prefer internal typed actions first
- Add Playwright-level automation for UI gaps
- Keep native desktop automation as fallback only

### Phase 4

- Add evaluation harness for agent runs
- Log failed steps, recovery attempts, and success criteria
- Compare agent outcomes against human-approved edits

## Sources

- Yjs docs: https://docs.yjs.dev/
- Hocuspocus intro: https://tiptap.dev/docs/hocuspocus/introduction
- Supabase Realtime docs: https://supabase.com/docs/guides/realtime
- Stagehand repo: https://github.com/browserbase/stagehand
- Playwright intro: https://playwright.dev/docs/next/intro
- nut.js repo: https://github.com/nut-tree/nut.js
- OpenAdapt repo: https://github.com/OpenAdaptAI/OpenAdapt
- OpenHands repo: https://github.com/All-Hands-AI/OpenHands
