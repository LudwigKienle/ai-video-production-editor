# Demo Project: Rainline

This example is a small public script-to-filming walkthrough. It is designed to
show the shape of an AI Video Production Editor project without shipping private
media, provider outputs, or API credentials.

## Story Premise

`Rainline` is a short sci-fi scene about a delivery rider who finds a damaged
memory device in a storm drain and realizes it contains one minute of footage
from tomorrow.

The premise is intentionally compact so contributors can test the full workflow
without a long production setup.

## Suggested Workflow

1. Open the desktop app with `npm run electron:dev`.
2. Create a new project named `Rainline`.
3. Paste `script.md` into the Script or Project Hub script field.
4. Run a Director pass.
5. Apply the Director treatment.
6. Generate concept references for the rider, storm drain, street, and memory
   device.
7. Generate storyboard images for the shots.
8. Generate one or two filming clips from the approved storyboard frames.
9. Run continuity review after rendered shots exist.
10. Move drift or watch shots into the re-film queue.
11. Assemble a short edit and export a test package.

## What This Demonstrates

| Area | What to inspect |
| --- | --- |
| Script-to-filming | The project can move from a raw script to Director treatment and storyboard. |
| Continuity | Repeated props, rain, neon light, and the memory device give continuity checks something to evaluate. |
| Model routing | Contributors can try different image/video providers with the same story material. |
| Review | The scene creates clear notes for re-film, prop drift, and tone consistency. |
| Export | The short duration makes it practical to test timeline and handoff exports. |

## Files

| File | Purpose |
| --- | --- |
| `script.md` | Public demo script. |
| `project-brief.md` | Art direction, characters, locations, and continuity anchors. |
| `shot-list.md` | Human-readable shot plan for comparing against the Director pass. |

## Contributor Ideas

- Add screenshots from the app using this demo project.
- Add a JSON fixture once the project import/export format is stable enough for
  public examples.
- Add a short recorded walkthrough showing script, Director, storyboard,
  filming, continuity review, and export.
- Add provider-specific notes for low-cost demo runs.

Do not commit generated provider media unless it is clearly licensed for public
redistribution.
