# Contributing

Thanks for helping improve AI Video Production Editor.

This project is most useful when contributors keep the local creator workflow in
mind: fast setup, transparent provider integrations, and no hidden hard
dependency on hosted services for the desktop core.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

For Electron development:

```bash
npm run electron:dev
```

## Before opening a pull request

Run the checks that match your change:

```bash
npm run build:web
npm run check:icons
```

If you change Electron runtime code, also run:

```bash
npm run build
```

Do not commit local secrets, release builds, certificates, generated media,
provider API keys, `.env.local`, or local virtual environments.

## Good first contribution areas

- Fix a provider adapter after an API change.
- Add a new model option behind an existing provider service.
- Improve README/docs for a workflow that was confusing.
- Polish UI states, empty states, or accessibility labels.
- Add focused tests around pure utility logic.

## Adding a model adapter

1. Add the provider call in the closest service module under `src/services`.
2. Add pricing metadata when provider pricing is known.
3. Add the model option and readiness requirements in the relevant workspace.
4. Make required inputs explicit in the UI before generation can start.
5. Document provider-specific constraints in the workspace copy or docs.
6. Run `npm run build:web`.

Keep adapters narrow. Provider APIs change often, so it is better to keep
request/response mapping obvious than to hide it behind premature abstractions.

## Pull request expectations

- Keep the change focused.
- Explain user-visible behavior changes.
- Include screenshots or short videos for visual UI changes when possible.
- Mention which checks you ran.
- Call out provider/API documentation links when adding or changing model calls.

## Licensing

By contributing, you agree that your contribution is licensed under the
project's GPL-3.0-or-later license.
