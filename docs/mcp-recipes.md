# MCP Recipes

Ready-to-paste prompts for Claude Code, Claude Desktop or Codex. Each recipe drives the
open editor through its MCP server, and you watch the result appear in the app.

**Before you start**

- Connect a client first: Settings → **Claude & Codex** → *Connect*. See
  [agent-connect.md](agent-connect.md).
- Keep the editor open. Every change autosaves into the open project and shows up at once.
- **Costs:** steps marked 💳 render with your provider keys and spend credits. Steps
  without the mark only write text (script, shot lists, prompts) and cost nothing beyond
  your Claude usage.
- Recipes start a new project unless you say otherwise, so they never overwrite the
  project you have open.

| Recipe | You get | 💳 |
| --- | --- | --- |
| [`/script-to-storyboard`](#script-to-storyboard) | A directed shot list for every scene, checked against the script | — |
| [`/cast-and-sets`](#cast-and-sets) | Consistent character sheets and locations | 💳 |
| [`/microdrama`](#microdrama) | A vertical microdrama episode from a one-line idea | optional |
| [`/same-shot-every-model`](#same-shot-every-model) | One shot rendered by several image models, side by side | 💳 |
| [`/continuity-pass`](#continuity-pass) | A scored continuity review, with fixes re-rendered | 💳 |
| [`/reverse-shot`](#reverse-shot) | The other side of a room for reverse shots | 💳 |
| [`/wardrobe`](#wardrobe) | Outfits per character, planned from the script | 💳 |
| [`/film-it`](#film-it) | Video for selected shots from their frames | 💳 |
| [`/local-first`](#local-first) | Concepts and frames on local models at no provider cost | — |
| [`/intro-reel`](#intro-reel) | A 15-second "Kumar Method"-style intro for your own channel | optional |

---

## /script-to-storyboard

A full shot list from your script, with no renders.

```text
Use the ai-video-studio tools. Create a new project called "<title>" (project_new).
Put this script into the story bible (project_update_story) and set the production
format to <short | commercial | microdrama | feature>:

<paste script>

Then read project_director_guide, get the scenes with project_director_scenes, and write
each scene's shot list with project_director_write_scene, using the exact cast, location
and prop names from the guide. When every scene is done, run project_director_review,
fix what it flags, renumber with project_renumber_shots, and open the storyboard phase
(project_open_phase). Do not render anything.
```

## /cast-and-sets

Character sheets that stay consistent across shots, and locations a camera can move in.

```text
Use the ai-video-studio tools on the open project. List the references
(project_list_references). For every character, write the description as a casting
sheet: a neutral grey background, one close-up portrait, and the outfit from front and
back cropped from the neck down, so the sheet shows only one face. For every location,
describe a 3/4 view with depth, the lighting, and where each character sits or stands,
with one fixed background landmark per character. Save these with
project_upsert_reference, show me the plan, and after my OK render each image with
project_generate_reference_image.
```

💳 One image per reference, more if you ask for changes.

## /microdrama

A vertical 9:16 episode with a hook, jolts and a freeze-frame ending.

```text
Use the ai-video-studio tools. New project "<series> – Ep 1" (project_new), production
format microdrama. Write a 60–90 second episode from this premise with
project_generate task write_script, length micro-drama: <premise>.
Read project_director_guide and follow the microdrama rules (hook in the first
seconds, jolts, freeze-frame cliffhanger). Direct every scene with
project_director_write_scene, then project_director_review. Stop before rendering and
summarise the episode beat by beat.
```

💳 Optional: continue with `/cast-and-sets` and `/film-it`.

## /same-shot-every-model

Pick the right image model for your look by rendering one shot with each candidate.

```text
Use the ai-video-studio tools on the open project. Call project_list_models and choose
4 image models suited to shot <n> (for example one Nano Banana, one Seedream 5 Pro,
one FLUX.3 and one local model). Render shot <n> with each one in turn
(project_generate_shot_images with model), look at every result (project_view_image),
and give me a short table: model, what works, what fails (identity, light,
composition, text). Then set the winner with project_set_models.
```

💳 One frame per model.

## /continuity-pass

```text
Use the ai-video-studio tools on the open project. Run project_review_continuity on
shots <range>. For each shot that scores below "aligned", apply the suggested promptFix
with project_upsert_shots. If a shot needs the reverse side of a location, create it
with project_generate_reference_angle (yaw 180) and set the shot's cameraYaw. Re-render
only the fixed shots (project_generate_shot_images) and review them once more. Report
before and after for each shot.
```

💳 Only the shots that get re-rendered.

## /reverse-shot

```text
Use the ai-video-studio tools on the open project. For the location "<name>", render the
reverse view with project_generate_reference_angle, yaw 180. Describe in the note what
must be visible from that side: <wall, window, door, landmarks>. Then set cameraYaw 180
on shots <list> with project_upsert_shots and re-render them.
```

## /wardrobe

```text
Use the ai-video-studio tools on the open project. For <character>, plan the outfits
from the script with project_plan_outfits. Or design them yourself with
project_upsert_outfits: name, when it is worn, and a prompt that covers only the
clothes, hair and accessories. Check the outfit model with
project_list_outfit_models, then render with project_generate_outfits. Finally,
assign the outfits per shot in the director shot lists.
```

## /film-it

```text
Use the ai-video-studio tools on the open project. Show the selected video model
(project_list_models) and ask me to confirm it. Then film shots <list> from their
frames with project_generate_shot_videos. These run in the background, so check with
project_job_status and tell me when each shot is done and which ones failed.
```

💳 Video is the expensive step: test one or two shots before a whole scene.

## /local-first

Concepts and storyboard frames without provider fees, on Draw Things or the ComfyUI
models from Local AI. Filming still needs a cloud video provider.

```text
Use the ai-video-studio tools on the open project. From project_list_models, pick a
local image model (draw-things, flux-3-klein-local, qwen-image-21-local or
z-image-turbo-local) and select it with project_set_models. Render all references
without an image (project_generate task concepts), then storyboard frames for shots
<range> (project_generate_shot_images). Keep everything on the local model.
```

Draw Things needs its API server enabled; ComfyUI models are downloaded under
**Local AI** in the app.

## /intro-reel

A 15-second vertical intro: your name, your craft, and one absurdly big mission. The
cameo twist follows the [intro reel plan](marketing/ludwig-intro-reel.md).

```text
Use the ai-video-studio tools. New project "Intro reel" (project_new), production
format social, 9:16. Add me as a character from these photos: <paths> (one face, a
neutral background). Add a location: a dark cinematic edit suite at night, two monitors
glowing with a storyboard grid, a hard tungsten side light, haze, a 3/4 view. Write six
shots with project_upsert_shots: (1) a slow dolly-in with my name, (2) a medium
close-up for lines 1 and 2, (3) an insert of the editor UI, (4) a close-up for line 3,
(5) a rack focus to a terminal for the cameo line, (6) the end card. Lines:
"My name is <name>. I'm a <craft>. And I'm going to <mission>." Stop before rendering.
```

Generated likenesses: use only your own face or voice, or someone who agreed, and say
in the post that the presenter is AI-generated.

---

Add your own recipes with a pull request: a name, what it produces, the prompt, and a
sample result from a project you can share.
