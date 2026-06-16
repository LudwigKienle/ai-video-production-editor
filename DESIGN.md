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

- App Title: 28px / semibold / tight tracking
- Section Title: 22px / semibold
- Card Title: 16px / semibold
- Body: 14px–15px / regular
- Meta / helper copy: 12px–13px / medium
- Micro labels: 11px / medium / restrained tracking

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

- Prioritize whitespace and grouping over dense panel stacking
- Top-level screens should answer:
  - what this area does
  - what the next action is
  - what matters right now
- Prefer progressive disclosure for technical controls
- Avoid putting every expert option above the fold

## 6. Depth & Elevation

- Use soft, diffuse shadows
- Limit strong glows and sharp gradients
- Prefer layered paper/surface depth over sci-fi glow depth

## 7. Do's and Don'ts

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
