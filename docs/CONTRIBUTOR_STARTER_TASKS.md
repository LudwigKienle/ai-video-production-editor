# Contributor Starter Tasks

This list is for contributors who want to help without needing to understand the
entire app on day one.

If you pick one of these, open an issue or comment on an existing issue first so
people know you are working on it.

## Documentation

- Add a short "first 10 minutes" walkthrough with screenshots.
- Add a Windows setup and troubleshooting section.
- Add a macOS Gatekeeper/notarization explanation for non-technical users.
- Document one complete workflow from script to storyboard to video export.
- Add a glossary for AI video production terms used in the app.

## Node Space

- Document one real Node Space graph with screenshots.
- Add a small example graph for image-to-video generation.
- Improve template names and descriptions so non-technical creators understand
  what each graph does.
- Add tests for blueprint/template metadata if the graph helpers change.

## Provider Adapters

- Check one provider model against the current public provider documentation.
- Improve an error message for missing API keys, quotas, or invalid inputs.
- Add a small provider troubleshooting note to the docs.
- Add a model option only when it fits an existing provider service cleanly.

## UI Polish

- Improve empty states for a workspace that currently looks unfinished.
- Add clearer disabled states for generation buttons that need required inputs.
- Improve mobile or narrow-window layout for a single workspace.
- Add accessible labels or button titles where intent is unclear.

## Tests

- Add tests around pure utility logic in `src/utils`.
- Add a regression test for an import/export helper.
- Add a small test for provider routing logic where no live API call is needed.

## A Good First Pull Request Looks Like

- One focused change.
- Clear before/after description.
- Screenshots for visual changes.
- No committed secrets, generated media, build outputs, or local environment
  files.
- A note about which command you ran, such as `npm run build:web`.
