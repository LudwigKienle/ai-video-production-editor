# Tutorial Video Playbook

How we turn real productions in AI Video Production Editor into tutorials that
grow the project. The format is adapted from Higgsfield's "direct a commercial"
tutorials. Their channel has about 493K subscribers, and the reference video
below reached about 301K views in its first 17 days. We copy the parts that
build trust and skip the hype.

Broader growth ideas (MCP recipe gallery, creator program, contests,
academy, SEO pages) are in `growth-ideas.md`.

Reference: Higgsfield AI, "How to prompt like a director with Opus 5.5 +
Seedance 2.5 (full workflow)", 7 Oct 2026, 17 min.
https://www.youtube.com/watch?v=kFKpcCHkuPI (analysed from the English
auto-captions on 24 Oct 2026).

## 1. What Higgsfield does

| Tactic | How it shows up in the video | Why it works |
| --- | --- | --- |
| Result first | The finished 30-second ad plays before anything is explained. | Proof before promise. Viewers decide in the first 30 seconds. |
| Explicit promise | "How I built the characters, planned the transitions, fixed the shots that went wrong, and what it cost, including the failed takes." | Sets the payoff and keeps people watching to the cost reveal. |
| Model names in the title | "Opus 5.5 + Seedance 2.5". | Rides search for whatever model is new right now. |
| A brand-like project | A fictional delivery app ("Higo's") with a pack shot and voice-over. | It looks like client work, so it doubles as portfolio inspiration. |
| Failures on camera | Wrong seat, a reverse angle that showed a wall, four place settings for three people, each followed by the fix. | Credibility, and the fixes are the most useful part to learn from. |
| Cost transparency | About 2,100 credits including iterations, compared with tens of thousands of dollars for a live-action shoot. | Makes the value tangible and pre-empts "what does it cost". |
| Outcome-named chapters | "Stop characters switching seats", "The 4-second product shot". | Every chapter is searchable and clips well. |
| Lead magnet | "All prompts and assets" link to an on-platform creator page with UTM tags (`utm_campaign`, `utm_creator`, `utm_content_type=de`) and an invite code. | Tracks each video and each language and attributes signups to the creator. |
| Claude skills as giveaways | A "director prompting" skill and a "blocking map" skill are offered for download. | Tied to the Claude wave, and every download keeps their workflow in use. |
| Mid-roll subscribe ask | At about 7:00: "about 80% of you aren't subscribed". | Placed after the value is proven, before the best part. |
| Community loop | A Discord with 200K members, a contest with a 200K-credit prize pool, "show us what you made". | Turns viewers into posters of user-generated content. |
| Career call to action | "Build it into an ad for your portfolio and reach out to your first client." | Sells an outcome, not a feature. |
| Localization | AI-dubbed audio and translated titles (YouTube shows a German version and the "made with AI" label). | One production reaches many language markets. |
| Creator as the face | A named creator directs. There are separate channels for creators and animation. | Personality plus scale. |
| The tutorial is the demo | Every step happens inside their product ("8 images for 1 credit"). | Teaching sells the tool without an ad break. |

Caution: Higgsfield's paid-creator marketing has drawn public criticism for
hype and undisclosed promotion (see the knowledge-hub entries
`yt-ibILQXo61R0` and `yt-qTYOCXSnWR0`). We copy the transparency, not the
superlatives.

### What the whole channel shows

These figures come from the 120 most recent of their 355 uploads, read on
24 Oct 2026. Views are as displayed on that day.

**The pivot.** A year ago the channel posted 10- to 60-second launch clips
("Official Launch", "Unlimited", "50 Presets", "Higgsfield x Kling 2.1"). They
got 2K to 45K views. For the last eight months it has posted long-form
stories, tutorials and money angles, which get 100K to 2.4M views. On YouTube,
product announcements do not travel; outcomes and stories do.

| Pillar | Examples | Views |
| --- | --- | --- |
| Originals (their own films and series) | Oneiric 2.4M · Arena Zero ep. 1 2M · MORK ep. 1 1.2M · Zephyr ep. 1 636K · Hell Grind feature 521K | The biggest numbers. They prove the tool and create a "studio" brand. |
| Full workflows, 20 to 46 min, titled "every prompt I used" | Save AI credits with Blender 812K · Ultra-realistic AI ads 721K · Animated short film 519K · Viral short film 400K | Steady 200K to 800K. |
| Money and side hustles | Faceless channel making $39,500/month 935K · Business idea 523K · $1,000,000 brand 396K · "5 AI side hustles" with Iman Gadzhi 256K | Very high. Treat with care (see the caution above). |
| A new LLM plus the tool | "Claude Opus 5.5 + Higgsfield …", "GPT-6 Astra + Higgsfield MCP made this entire video in one chat" 315K | Riding every frontier-model launch within days. |
| Challenges and collaborations | AI vs. a pro VFX artist · feat. ErikDoesVFX · celebrity action film with N3on and Israel Adesanya | Borrowed audiences. |
| Model tests | "Seedance 2.5 vs 2.0: the truth" · "I rated every AI model" | 100K to 130K, evergreen search traffic. |
| Events | Cannes screening vlog, "Road to Cannes" | Low views (45K to 127K); this is PR, not reach. |

**Title patterns.** Numbers ("$39,500/month", "28 tips", "5 steps", "60M
views"); "changed … forever"; "world's first"; "no one talks about this";
"every prompt I used"; and the model name in every title.

**Other channels.** Collaborations are co-published with sub-channels
(Higgsfield Marketing, Animation, Creators), so one video lands in several
subscriber feeds.

**Beyond YouTube.** The website has one search landing page per keyword ("AI
video generator", "image to video AI", "AI video editor", "video to video",
"AI long video generator"), each with FAQ and pricing. The navigation lists
MCP, API, a ChatGPT plugin, an Academy and Ads Studio. They are present
wherever people already work: in chat assistants, in search, and in
education.

**Speed on new models.** Each new model gets a same-week "Higgsfield x [model]"
post. Our edge here: we add new models within days too (FLUX.3, Krea 3 and
GPT Image 2 in October 2026), so each one deserves a post that says "now in
the open-source editor".

## 2. The production workflow they teach

Useful for our own productions and as a checklist for features.

**Setup.** One project per ad, with a folder per asset type. "Two weeks and 400
generations later you'll be glad you did."

**Characters**
- Claude turns a short concept into a detailed character-sheet prompt.
- Plain grey background, a close-up portrait plus the outfit from front and back.
- Neck-down crops for the outfit panels, so the sheet has only one face. They
  call this a must for consistency.
- Explore with a cheap model that returns many options. Fix details (skin
  texture, softer light, freckles) with an edit model, here Seedream 5 Pro.
- Save the result as a named element ("character Mika") and attach it to every
  scene.

**Locations**
- Use image references to lock lighting, layout and background before
  generating, like a real shoot.
- Ask for a 3/4 angle, not head-on. The depth gives camera moves something to
  hold on to.
- Use edit prompts to fix layout (a smaller cabinet, a clear table) while
  keeping lighting and texture.
- Put the props into the location: one chair and one plate per character, so
  seating is planned before the video pass.

**Props and extras**
- Give a prop its own reference when it travels between characters (the phone)
  or must read on camera (bags with the logo facing the lens).
- Build a group of extras as a single image (four musicians together).

**Directing**
- A Claude skill turns the scene description into shots with dialogue timing
  and camera moves.
- Label every reference with the same name the prompt uses.
- Generate about 15 to 17 seconds of multi-shot video per pass with Seedance
  2.5, at about 200 credits per pass.

**Fixing takes**
- Assign every character a seat explicitly. Leaving one out was the cause of
  the "switching seats" error.
- Add a wide establishing shot at the start of the generation. It is the
  keyframe that locks positions, and it gets cut from the final edit.
- Tie each character to a background landmark (skyline behind Mika, shelves
  behind Jenny, red lamp behind Alex). This gives you something to check while
  the camera moves.
- For a reverse angle, state where the camera stands relative to the anchors
  and what must be in the background.
- When the layout is still wrong, generate a top-down, colour-coded blocking
  map (one colour per character, plates and props marked), map each colour to
  a character in the prompt, and attach the map as a reference.

**Transitions and sound**
- Match cut on an action (the phone tap): same framing and same camera motion,
  only the location changes.
- Hide a cut behind a body crossing the frame (a natural wipe).
- Bring in the ambience of the next location before the picture changes (a
  J-cut).

**Pack shot.** One move in 4 seconds: start close on the logo, pull back to the
action, and make sure something is happening when the move stops. Add the
voice-over line.

**Delivery.** Reframe the widescreen master to vertical without cropping.
Pick the strongest moments across takes.

### Where we already stand

The codebase already covers parts of this: blocking and landmark context in
`src/utils/shotContextComposer.ts`, `src/utils/environmentWorldModel.ts` and
`src/components/SceneMap3DView.tsx`, establishing-shot handling, a match-cut
reference in `src/services/autoCutService.ts`, reframing, and concept
references per character, environment and product. Before making a claim on
camera, check that the feature works in the running app.

Gaps that would also make good episodes:
- A character-sheet preset (grey background, one face, neck-down outfit panels).
- A per-character seat and landmark field that is written into every shot prompt.
- A blocking-map generator: a top-down colour map from the scene map, attached
  as a reference.
- A per-project cost ledger that includes failed takes.
- An exportable "Claude director skill" for our MCP server.

## 3. Our version

### Positioning in every video

- An open-source workflow layer for AI filmmaking that Claude can drive through
  our MCP server.
- Bring your own models: cloud models at provider prices with no platform
  markup, Midjourney through your own subscription, or fully local models
  (Draw Things, ComfyUI) at no generation cost.
- The project stays on your machine.

Accuracy rule: say "free" only for the app and the local-model path. Cloud
models need provider keys, and Midjourney needs a paid subscription. Present
superlatives as opinion, not measurement.

### Flagship format: "I directed X — here's what it cost"

Title formula: `[Outcome] with [current model names] ([full / open-source workflow])`

Examples:
- How to direct an AI commercial with Claude + Seedance 2.5 (open-source workflow)
- I made a 60-second microdrama by talking to Claude, with an open-source AI studio
- Same ad, two budgets: cloud models vs. 100% local models

Run sheet (about 12 to 18 minutes):

| Time | Beat |
| --- | --- |
| 0:00 | The finished piece, no intro. |
| 0:30 | The promise: how it was built, what broke, what it cost, including failed takes. |
| 0:45 | Setup: new project and folder structure (and Claude connected through MCP). |
| 1:00 | Cast: character sheets and the consistency trick. |
| 3:00 | Locations: 3/4 angle, props built into the set. |
| 6:00 | Directing in Claude: show the prompt, the references and the timing. |
| ~40% | Ask for a star: "A GitHub star is the only thing this costs you, and it keeps the project free." |
| 8:00 | Generate: the first take, what is wrong with it, the fix (always at least one failure). |
| 11:00 | Transitions: one named technique per transition (match cut, body wipe, J-cut). |
| 14:00 | Pack shot or ending. |
| 15:00 | Cost reveal: a table comparing the cloud path, the local path, and the failed takes. |
| 16:00 | Call to action: "Download the project, make your version, post it with #MadeWithAVPE, and we feature the best ones." |

### Lead magnet: everything open

Higgsfield sends viewers to a gated page on their own platform. We do the
opposite, because open is the selling point:

- For every episode, add a folder to the repo (or a release asset) with the
  project file, every prompt, the references we are allowed to share, and the
  Claude/MCP instructions used.
- Link it from the description with a tracking parameter per channel and
  language, for example `?utm_source=youtube&utm_campaign=ep01&utm_content=de`.
  Point it at a small landing page if GitHub would drop the parameters, and
  compare with the referrers in GitHub traffic.

### Community loop

- Use GitHub Discussions or Discord with a "Show your build" channel.
- Run a monthly showcase: the best community builds appear in the next video
  and get a contributor credit in the README.
- Offer a prize pool only if a model provider sponsors one, and disclose it.

### Distribution per episode

- YouTube long form, with chapters named by outcome and auto-dubbing turned on
  (German and English at least).
- 3 to 5 Shorts and Reels: each transition trick and each failure-plus-fix is
  its own short.
- LinkedIn: founder angle (why open source, what it cost compared with a
  shoot).
- X and Threads: a 20-second before/after clip plus the repo link.
- Reddit (r/aivideo, r/StableDiffusion for the local path): the practical
  workflow, not a pitch.

### Creator program

- Invite AI filmmakers to make their own tutorials with the editor. They keep
  their channel; we link them from the README and showcase their work.
- Every contribution (a skill, a preset, a provider adapter) names its creator
  in the release notes.

### Cadence and metrics

- One long tutorial every two weeks, three Shorts a week from that material.
- Track per episode: views at 7 and 28 days, average watch time at the cost
  reveal, stars within 48 hours, clicks on the project download, and new issues
  or discussions.
- Turn the most-asked question after each episode into the next episode.

### Content pillars for us (from the channel analysis)

1. **Originals:** short films made entirely in the editor (start with OWNED).
   This was their strongest pillar.
2. **Full workflows:** "every prompt I used", with project files open on GitHub.
3. **The cost angle:** "Make AI films for €0 with local models". Their best
   tutorial was about saving credits (812K views), and this is where we win
   outright.
4. **A new model plus Claude:** a same-week video or post whenever a model or
   frontier LLM ships, driven through our MCP server.
5. **Challenges:** AI-assisted against a traditional VFX or edit workflow,
   ideally with a guest.
6. **The founder story:** Ludwig's serialized "building the Blender of AI
   filmmaking" journey (see `ludwig-intro-reel.md`).

Leave out the money and side-hustle angle. It brings views but conflicts with
an honest open-source brand, and it is exactly what critics attack.

### First three episodes

1. **The OWNED microdrama, directed by talking to Claude.** Claude drives the
   editor through MCP. Show the full loop and the cost.
2. **The same 30-second ad with two budgets.** Cloud (Seedance 2.5 plus a
   Seedream edit) against local (Draw Things or ComfyUI), with the cost table.
3. **"Stop characters switching seats".** Blocking, landmarks and an
   establishing keyframe in our editor, as a short, searchable fix episode.
