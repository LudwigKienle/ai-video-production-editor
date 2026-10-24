# Ludwig Intro Reel: "The Blender of AI Filmmaking"

A 15-second vertical intro in the style of the viral "Kumar Method" reel. It
is the first episode of a serialized founder story. Made in the editor itself,
it also becomes the second piece of content: "How I made my intro in my own
open-source editor".

## The reference: "The Kumar Method"

@thekumarmethod is a retired accountant whose first reel passed 11M views and
2.7M likes, and the account reached about 1M followers with 14 posts. The
breakdown below follows the Masterhooks analysis (20 Jun 2026). I have not
watched the reel frame by frame myself.

- **One three-part line:** name, credential, an absurdly big mission. "My name
  is Kumar. I'm a retired accountant. And I'm going to become the biggest
  accounting influencer in the world."
- **Bold red text** with only the name, title and experience on screen.
- **Movie-villain staging:** dramatic light and cinematography, total
  confidence, no smile. The contrast with the person is the scroll stopper.
- **The cameo twist:** his wife steps in and says "My husband wants to be
  famous. Please follow him." The humour lowers the stakes, and her presence
  is social proof.
- **Underdog, not expert:** "watch me try" rather than "follow me because I
  know". People follow the story, not the niche.
- **Serialized:** the intro only promises a journey, and the follow-ups pay
  it off.
- **Amplifiers:** creators recreated and analysed the format, and tutorials
  (some made with Higgsfield, for people without a studio) spread it further.

## Our version

**Line (English, main version)**

> My name is Ludwig Kienle.
> I'm a filmmaker.
> And I'm going to build the Blender of AI filmmaking.

**Cameo twist.** Pick one:

- **A: Jeff, the agent (recommended).** The Midjourney background agent "talks".
  A terminal or chat window on the second monitor types, with a flat
  text-to-speech voice: *"My human wants to build the Blender of AI
  filmmaking. Please star his repo."* This is on-brand (agentic, Claude, MCP),
  needs no second person, and is easy to repeat in every episode.
- **B: a real person close to you**, for example a partner or a parent. This
  is the closest to Kumar and the most human. Use a real recording and get
  their consent. Do not generate them with AI.
- **C: the editor itself.** The app's status bar reads "Ludwig wants to be
  famous. ⭐ Please star the repo."

**Line (German version)**

> Ich heiße Ludwig Kienle.
> Ich bin Filmemacher.
> Und ich baue das Blender fürs KI-Filmemachen.
>
> Cameo (Jeff): „Mein Mensch will das Blender fürs KI-Filmemachen bauen. Bitte gebt ihm einen GitHub-Stern.“

Accuracy check before publishing: "filmmaker" (or a more specific credential
such as "VFX artist" or "editor in German TV") is Ludwig's choice. Any
experience line (years, credits) has to be true. The star count in the end
card has to be current on the day of posting (140 on 23 Oct 2026). "Blender"
is used only as a comparison: no Blender logo and no implied affiliation.

## Shot list (9:16, about 15 seconds, plus a 16:9 version for YouTube and LinkedIn)

| # | Time | Picture | Sound | Text (bold red, condensed sans, left-aligned, stacked) |
| --- | --- | --- | --- | --- |
| 1 | 0.0–2.5 | Slow dolly-in on Ludwig at his desk in a dark edit suite. Two monitors glow behind him with the editor's storyboard grid. Hard key light from the side, deep shadows, no smile. | A low drone and a single deep hit on the cut. | `LUDWIG KIENLE` |
| 2 | 2.5–5.0 | Same move, closer (medium close-up). He speaks line 1 and line 2. | His voice, dry and close-miked. | `FILMMAKER` + an honest experience line, for example `[X] YEARS IN FILM & TV` |
| 3 | 5.0–7.5 | Insert: a screen recording of the editor. Claude chat drives it, and storyboard frames fill in one by one (real footage, sped up). | Typing clicks and render ticks. | `OPEN SOURCE · RUNS LOCAL · ANY MODEL` |
| 4 | 7.5–10.5 | Back to Ludwig in close-up, looking straight into the lens. Line 3: "And I'm going to build the Blender of AI filmmaking." | Two beats of silence, then a hard bass hit on "Blender". | `THE BLENDER OF AI FILMMAKING` (larger) |
| 5 | 10.5–14.0 | Cameo: a rack focus to the second monitor. A terminal titled `jeff@midjourney-agent` types the line, read by the flat voice. Ludwig glances at the monitor, then back to camera with a tiny shrug. | TTS line, a keyboard clack, the drone drops out. | none (the terminal text is the joke) |
| 6 | 14.0–15.5 | End card: black, the repo URL, a star icon, `140 → ?` | A soft riser cut off hard. | `github.com/LudwigKienle/ai-video-production-editor` |

Caption: `Day 1 of building the Blender of AI filmmaking. Open source. Follow
the journey 🎬` plus hashtags `#AIfilmmaking #opensource #kumarmethod`.

## How to produce it

**Recommended: a hybrid.** Real face and real voice, AI only for the world.

1. **Record Ludwig for real** (phone or camera at 4K, 24 or 25 fps): shots 1,
   2, 4 and 5 against any dark background, with one hard side light and a
   practical light (monitor glow) behind him. Record the voice on a close mic.
   Authenticity is the point of the format.
2. **Make the room in the editor** if the real room is not cinematic enough.
   - In Concept, create an environment: *"dark cinematic edit suite at night,
     two large monitors glowing with a storyboard grid UI, hard tungsten side
     light, deep shadows, haze, 3/4 angle, anamorphic, film grain"*. Use
     Seedream 5.0 Pro or Krea 3, then tidy the layout with an edit model.
   - Option: in Filming, use Seedance 2.5 Omni with the real clip as the
     performance reference and the generated room as the environment
     reference (the AWZ v2v recipe in the knowledge hub).
3. **Shot 3:** screen-record the real editor (Claude through MCP filling a
   storyboard). Do not fake the UI.
4. **Shot 5:** screen-record a real terminal, plus a TTS voice (ElevenLabs or
   the system voice).
5. **Edit and grade in DaVinci Resolve:** red titles as a Fusion text
   template, a crushed teal-black grade, and grain. Deliver 1080×1920 and
   1920×1080.

**Fully AI version (optional, for the "how I made it" follow-up).** Create
Ludwig as a Concept character from 4 to 6 real photos (grey background, one
face, the playbook's character-sheet rules). Storyboard shots 1, 2, 4 and 5
with `@ludwig` and `@edit-suite`, then film them with Seedance 2.5 using his
recorded voice for lip sync. Only Ludwig's own likeness and voice are used,
with his consent. Label the reel as AI-generated where the platform asks.

Rules for a generated presenter, from Higgsfield's "GPT-6 Astra + Higgsfield
MCP made this entire video in one chat" (knowledge hub `yt-NuvA32_dmtg`):

- Start from a short real clip of Ludwig with a steady light, a visible face
  and clean speech. It works better than any written description.
- Split every presenter prompt into two parts: look and direction (wardrobe,
  set, angle) and only the spoken words.
- One complete thought per take, and start and end the take cleanly.
- Generate one take first and check the face, voice, eyes, lips and
  pronunciation ("Kienle", "Blender") before generating the rest.
- Log each take: number, prompt, result, selected file.
- Disclose the generated presenter in the video itself.

## The series after the intro

1. **Intro reel** (this one).
2. "How I made my Kumar intro in my own open-source editor" (a tutorial using
   the playbook format).
3. "Day [n]: Claude directed a microdrama inside my editor" (OWNED, through
   MCP).
4. A star-count update every 100 stars, with the same staging and a new cameo
   line from Jeff.
