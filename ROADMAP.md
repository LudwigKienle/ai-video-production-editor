# Roadmap

This roadmap describes the public product direction for AI Video Production
Editor. It is not a fixed promise; priorities may change based on user feedback,
provider API changes, and release quality.

## Current Focus

- Make the first download and first launch feel clear and trustworthy.
- Improve onboarding for provider API keys and local project setup.
- Make the first 10 minutes after cloning easier to understand.
- Keep official macOS builds signed and notarized.
- Keep Windows installers easy to find and test.
- Collect focused feedback through GitHub Issues.

## Near-Term Priorities

- Better first-run onboarding inside the desktop app.
- Clearer setup flow for bring-your-own-key providers.
- Expand the public demo project with screenshots and, later, importable project
  fixtures.
- Public demo screenshots, workflow GIFs, and contributor-friendly examples.
- Node Space documentation with real AI filmmaking graph examples.
- Improved release notes for each desktop build.
- More short tutorial videos for common workflows.
- Windows code signing evaluation to reduce SmartScreen friction.

## Product Areas

### Production Workflow

- Script and scene planning.
- Reference management.
- Storyboard and shot generation.
- Multi-model output comparison.
- Editing, review notes, and export handoff.

### Provider Support

- Keep model adapters current as APIs change.
- Add issue templates for provider-specific bugs.
- Improve error messages when API keys, quotas, or provider settings are wrong.

### Desktop Reliability

- Faster startup.
- Clearer local storage behavior.
- Better diagnostics for install and launch problems.
- More predictable release validation before public builds.

## Feedback Wanted

Please open an issue if you can provide:

- A reproducible install or launch problem.
- A provider/model bug with exact provider name and steps.
- A workflow pain point from a real production use case.
- A tutorial request for a task that is hard to understand.

Issues:
<https://github.com/LudwigKienle/ai-video-production-editor/issues>

## Contributor-Friendly Milestones

These are intentionally small enough for outside contributors to help with:

- Documentation: first-run walkthrough, provider setup, and workflow examples.
- Node Space: template docs, example graphs, and focused metadata tests.
- Install support: Windows/macOS troubleshooting notes and screenshots.
- Provider support: clearer API-key, quota, and model-input error messages.
- Community: label issues with `good first issue` and `help wanted` when the
  task has a clear scope.
