# Open Source Launch Plan

Goal: launch AI Video Production Editor as a credible local-first open-source AI
video studio, not as a paywalled SaaS clone.

Release scope: the public launch is the local Electron desktop editor. Hosted
APIs, portal billing, managed credits, team sync, and cloud rendering are
optional layers and must not be required for someone to run the desktop core.

## Positioning

Primary message:

> Local-first open-source AI video production editor for orchestrating
> multi-model media workflows.

Short launch headline:

> Blender-inspired workflow control for AI video: local projects, BYOK model
> providers, and an extensible desktop studio.

## License and business model

- Desktop/editor core: GPL-3.0-or-later.
- Hosted APIs, cloud rendering, managed credits, team sync, support, and custom
  deployment services can remain separate commercial offerings.
- Do not put the local desktop core behind a hard paywall.
- Let the open app create trust and distribution; monetize convenience, hosted
  infrastructure, and professional support.

## Must do before making the repo public

- Keep the public project branded as "AI Video Production Editor" across app,
  docs, HTML entry points, sample data, and hosted API stubs.
- Publish from a fresh curated repository or from a history-rewritten branch.
  Deleting files in the latest commit does not remove older private planning
  material from git history.
- Run `npm run check:public-release` before every public release.
- Run `npm run check:public-release:strict` before publishing a curated source
  archive or switching repository visibility.
- Confirm no real secrets are tracked:
  - `.env`
  - `.env.local`
  - `cert.p12`
  - `certificate.txt`
  - release archives and installers
- Do not commit `.dmg` files to git. Attach desktop installers to GitHub
  Releases through the desktop release workflow.
- The README should start with a "Download newest version" button linking to
  `https://github.com/LudwigKienle/ai-video-production-editor/releases/latest`.
- Official public releases should attach both the signed/notarized macOS `.dmg`
  and the Windows `.exe` installer.
- Check history for accidentally committed secrets:
  - `git log --all -- .env .env.local cert.p12 certificate.txt`
- Confirm local ignored credential artifacts such as `cert.p12`, `*.pem`,
  `*.key`, and real `.env*` files are outside the release copy.
- Run a filename and content audit for private client/project references.
- Replace or remove private screenshots, generated client media, and local
  release artifacts.
- Add at least one current screenshot or short demo clip to the README.
- Create labels:
  - `good first issue`
  - `model-adapter`
  - `provider-api`
  - `ui-polish`
  - `docs`
  - `bug`
  - `security`
- Enable Discussions only after the README and first issues are ready.
- Enable GitHub private vulnerability reporting.

## First public issues

- Add a new FAL model adapter.
- Improve Electron setup docs for Windows.
- Add screenshots to README.
- Add provider adapter tests for one pure request mapping function.
- Improve empty states in one workspace.
- Document optional audio mastering setup.

## Launch checklist

- README has a clear one-sentence pitch.
- README setup takes less than 5 minutes for the web app.
- `.env.example` contains only placeholders.
- `npm run build:web` passes.
- `npm test` passes.
- `npm run check:icons` passes or known failures are documented.
- `npm run check:public-release` passes.
- `npm run check:public-release:strict` passes in the final release copy.
- `npm audit --audit-level=low` reports zero vulnerabilities.
- A version tag, for example `v0.1.0-open-source`, creates a GitHub Release
  with downloadable macOS `.dmg` and Windows `.exe` installers.
- For a trusted macOS download, GitHub Actions has Apple signing/notarization
  secrets configured and the release workflow signs/notarizes the app before
  publishing the `.dmg`.
- GitHub topics are set:
  - `ai-video`
  - `electron`
  - `video-editor`
  - `generative-ai`
  - `local-first`
  - `byok`
  - `open-source`
- Initial release tag is created, for example `v0.1.0-open-source`.

## Suggested announcement channels

- GitHub release post.
- Hacker News "Show HN".
- Product Hunt.
- Reddit communities focused on AI tooling, local-first software, open source,
  and video production.
- Short demo video on X/LinkedIn/YouTube.

## Announcement draft

I am open-sourcing AI Video Production Editor, a local-first desktop studio for
AI video workflows.

It lets creators bring their own provider keys, manage projects locally, route
work through multiple image/video/audio models, and extend the editor with new
model adapters. The goal is a Blender-inspired open workflow layer for AI video:
free local core, transparent integrations, and optional hosted services for
credits, cloud rendering, teams, and support.

Feedback, model adapter contributions, docs improvements, and UI polish are
especially welcome.
