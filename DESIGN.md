# DESIGN.md

## 1. Visual Theme & Atmosphere

This product should feel like a calm creative workspace rather than a technical control panel.

- Primary inspiration: Notion-style productivity UI
- Product adaptation: slightly more cinematic and studio-oriented than pure document software
- Emotional tone: clear, editorial, approachable, organized
- Interface density: medium
- Interaction tone: quiet, confident, low-noise

The UI should help users move through complex AI workflows without making the product feel like it is built only for engineers.

## 2. Color Palette & Roles

### Core Neutrals

- `Canvas`: `#0f1115`
- `Surface`: `#171a20`
- `Surface Raised`: `#1d2128`
- `Surface Soft`: `#232831`
- `Border`: `#2f3742`
- `Border Strong`: `#3c4653`
- `Text Primary`: `#f3f4f6`
- `Text Secondary`: `#b3bbc7`
- `Text Tertiary`: `#8d97a6`

### Warm Editorial Accents

- `Accent`: `#7c8cff`
- `Accent Soft`: `#aab4ff`
- `Accent Glow`: `rgba(124, 140, 255, 0.16)`
- `Warm Highlight`: `#d8b46a`
- `Success`: `#57b894`
- `Danger`: `#dd7c7c`

### Light Theme Translation

- `Canvas`: `#f4f1ea`
- `Surface`: `#ffffff`
- `Surface Raised`: `#fbf8f2`
- `Surface Soft`: `#f2eee6`
- `Border`: `#ddd6ca`
- `Border Strong`: `#c5bbac`
- `Text Primary`: `#23272f`
- `Text Secondary`: `#5f6877`
- `Text Tertiary`: `#7f8897`

## 3. Typography Rules

- Primary UI font: `Instrument Sans`, fallback to high-quality sans-serif stack
- Monospace font: `IBM Plex Mono`
- Typography should feel editorial, not dashboard-heavy
- Avoid overly tight uppercase labels everywhere
- Small helper text should remain readable and soft, not neon or high-contrast

### Type Hierarchy

Use the rem-based scale tokens in `index.css` (`--fs-2xs` … `--fs-2xl`, ratio ≈ 1.2) instead of ad-hoc pixel sizes.

- App Title: `--fs-2xl` / semibold / tight tracking
- Section Title: `--fs-xl` / semibold
- Card / panel title: `--fs-md` (0.9rem) / semibold — the browser panels (Effects, Transitions, Titles…) all use this one size
- Body: `--fs-sm` / regular / line-height `--lh-body` (1.45)
- Meta / helper copy: `--fs-xs` / medium
- Micro labels: `--fs-2xs` (≈10.5px) / semibold / 0.08em tracking — **this is the floor; never go smaller**
- Timecodes and numbers: IBM Plex Mono with tabular figures

### Readability rules (apply everywhere)

- Line height 1.45 for any copy longer than a label; 1.2 for titles
- Lines of helper copy stay under ~70 characters — wrap the container, don't shrink the type
- Muted text uses `--app-muted`, never a lighter grey: contrast stays ≥ 4.5:1 in both themes
- Never colour text with fixed Tailwind greys (`text-gray-*`) in new code; use the tokens. Legacy panels are mapped to the tokens by the global overrides in `index.css` (search "Global type scale")

## 4. Component Stylings

### Header

- Sticky, translucent, paper-like surface
- Minimal chrome
- Brand area should read like a product workspace, not a developer console
- Status indicators should be quiet and compact

### Buttons

- Primary button: solid accent fill, subtle lift, no aggressive glow
- Secondary button: raised neutral surface with soft border
- Tertiary / ghost button: quiet text with hover surface only
- Avoid candy gradients except in very limited highlight areas

### Inputs

- Soft raised fields
- Clear focus ring
- Generous padding
- Placeholder copy should be instructional and plain-language

### Panels & Cards

- Rounded corners
- Soft separation through layered surfaces and subtle borders
- Prefer spacing over hard separators
- Cards should feel like organized sheets, not “control modules”

### Navigation

- Use pill- and sheet-like navigation instead of tab-strip energy
- Active items should feel selected, not “lit up”
- Keep visual hierarchy obvious between group navigation and sub-navigation

## 5. Layout Principles

### Page anatomy (post pages)

Every post page (Media, Cut, Edit, Fusion, Color, Fairlight, Deliver) follows the same left-to-right reading order, so users only learn it once:

1. **Browser / sources on the left** — what you can bring in (media, effects, tools, generators)
2. **Viewer in the centre, top** — the one fixed point on the page; it always shows the shared program
3. **Work area under the viewer** — the page's own surface (media pool, node comp, tool forms)
4. **Inspector / mixer on the right** — properties of what is selected
5. **Clip strip + shared timeline at the bottom** — the same timeline, playhead and selection on every page

Selection lives in exactly one place per page (the viewer / the timeline), and every panel reads from it. Never keep a second, private selection.

### Browsers (Effects, Transitions, Titles…)

### Panel kit (`pk-*` classes in `index.css`)

Every browser panel is assembled from the same few parts, so new panels look finished on day one:

- `fx-browser` shell: header (`fx-browser__title` + one `edit-seg`), `fx-search`, `fx-filters`, `fx-browser__scroll`, `fx-browser__footer` (or `--bar` when it carries the primary action)
- `pk-steps` / `pk-step` for guided flows (Music: read → refine → generate)
- `pk-card`, `pk-row`, `pk-list` for content; `pk-seg` for mutually exclusive choices; `pk-switch` for on/off
- `pk-details` for progressive disclosure — expert settings live behind a summary that states the current value
- `pk-chip`, `pk-score`, `pk-alert`, `pk-progress`, `pk-empty` for status. Empty states say what to do next, never just "nothing here"
- Tiles: `fx-tile` (button) or `fx-tile fx-tile--div` when the tile carries its own `fx-tile__actions`


- Header row: title on the left, one segmented control on the right
- One rounded search field directly beneath
- One row of pill filters; "All" groups results into sections with quiet uppercase headers
- Content as a thumbnail grid (16:9 tiles, name below, tooltip carries the description). Show the effect *on the actual frame* rather than describing it in prose
- Footer line with the single hint that matters right now (e.g. "Select a clip to apply effects")
- Disabled state = dimmed, never hidden; the user should see what exists before they can use it

- Prioritize whitespace and grouping over dense panel stacking
- Top-level screens should answer:
  - what this area does
  - what the next action is
  - what matters right now
- Prefer progressive disclosure for technical controls
- Avoid putting every expert option above the fold


### Steps and tools (Project Hub)

The left navigation lists **steps** in production order: Script → World (optional) → Concept → Storyboard → Filming → Review → Marketing. Everything else is a **tool** that opens from a step and never gets a step number: Projects and Team from the header, Director and Scene Wall from the Storyboard bar. A tool page shows "Storyboard · tool" and one "‹ Back to Storyboard" control instead of prev/next. Checkmarks come from content (script written, references with images, frames, videos, review, promo assets), never from position.

**Scene strip.** Storyboard and Filming carry the same chapter strip: All · Sc 1 · Sc 2 … with per-scene progress (frames or videos out of shots). Selecting a scene scopes the board, the Director, "Generate from Script" and "Film"; a new shot list for a scene merges into the existing list. When a scene is complete the strip offers "Next: Sc N+1". Scene Wall (Pro) is the wall view of the same scenes for long scripts; picking a scene there selects it in the strip.

### Prompt preview

Wherever a prompt is typed (Concept card, Storyboard and Filming inspectors, the Image and Video generators) a "Prompt for <model>" disclosure (PromptPreview) shows the text exactly as it reaches the selected model after the per-model shaping, with presets in place and a Copy button. Generate is one click: a Concept card without a written prompt gets one from the AI first, in the voice of the selected model; a shot without a motion prompt gets one when it is filmed and keeps it.

### Phase bars (Project Hub)

Every production phase opens with the same bar, in this order:

1. **Title row** — phase name + one sentence, primary action on the right (`app-button app-primary`), then "Next: …" as a quiet secondary. One primary per bar, never two.
2. **Tools row** — only the picks that change *what* gets generated (aspect ratio, model, length). Labels are small uppercase, groups have no boxes.
3. **`phase-settings` disclosures** — everything that tunes *how* (camera, lens, persona filter, LoRA, model-specific options, context memory). The summary always states the current value, so a closed disclosure still tells you what is set.

No `hover:scale-105`, no coloured hero buttons per phase (green/cyan/amber/blue): colour would have to mean something, and here it did not.


### Shot boards (Storyboard, Filming)

Shots are a grid of small 16:9 tiles — frame, shot number, scene slugline, one line of description, a status chip (Generating… / Video / Frame ready / No frame / score). One tile is selected; its full editing card renders **once**, in a sticky inspector beside the grid, with ‹ › to step through shots. The board shows *what exists*; the inspector shows *how to change it*. Never render the full card for every shot.

## 6. Depth & Elevation

- Use soft, diffuse shadows
- Limit strong glows and sharp gradients
- Prefer layered paper/surface depth over sci-fi glow depth

## 7. Principles that make the software feel effortless

Distilled from the NLE research (Resolve, FCP, Premiere) and the UI/typography feedback; check new work against these.

1. **Reduce to the essential.** A panel shows one primary action and hides expert options behind progressive disclosure (`<details>`, "Advanced", segmented sub-tools). If a screen needs a legend, it has too much on it.
2. **Visual hierarchy before decoration.** Size and weight carry hierarchy; colour is reserved for the one primary action and the accent on the selected item.
3. **Consistency is the feature.** Same header, same search, same filter pills, same tile, same inspector layout on every page. Reused patterns are what let people work "without thinking".
4. **Immediate feedback.** Every action answers within 100 ms: hover lifts a tile, a fader moves the meter, a generate button reads "Generating…" and the status line says where the result landed.
5. **Whitespace is structure.** Group with spacing first, borders second, boxes-in-boxes never.
6. **Typography is the interface.** One sans family for UI, one mono family for numbers, a fixed scale, a readability floor. Text that is hard to read is a bug.
7. **Accessible by default.** Keyboard reachable buttons, `aria-label` on icon-only controls, visible focus rings, contrast ≥ 4.5:1, no colour-only meaning.
8. **The timeline is the truth.** Whatever a page does, it reads from and writes to the shared sequence, so nothing the user does is ever "somewhere else".
9. **Make it a pleasure.** Small, fast, physical motion (a tile lifting, a meter bouncing) rewards use; long spinners and modal detours punish it.

## 7b. Do's and Don'ts

### Do

- Use calm neutral surfaces
- Write labels in user language
- Make complex flows feel guided
- Keep high-frequency actions visually obvious
- Reduce visible technical jargon in default views

### Don't

- Don’t make screens feel like engineering dashboards
- Don’t overuse uppercase labels or badge noise
- Don’t stack too many bordered boxes inside bordered boxes
- Don’t make providers, model IDs, or internal backend concepts the visual hero
- Don’t use purple-on-black neon UI language by default

## 8. Responsive Behavior

- Header actions should collapse cleanly without feeling cramped
- Workspace navigation should wrap into clear rows, not dense button clouds
- Maintain large tap targets
- Preserve the same visual hierarchy on smaller screens

## 9. Agent Prompt Guide

Use this style when designing or refactoring UI:

"Design this interface as a calm creative workspace inspired by Notion, adapted for AI media production. Use soft dark-neutral surfaces, editorial spacing, restrained accent color, clear hierarchy, and plain-language labels. Reduce technical dashboard energy. Prefer sheet-like panels, subtle borders, and readable typography over bright gradients, dense chrome, and control-heavy layouts."
