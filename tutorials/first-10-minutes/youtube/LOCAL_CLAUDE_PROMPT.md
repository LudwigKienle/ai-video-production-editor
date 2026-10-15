# Prompt for a local Claude (Claude Code or Claude Desktop with Claude in Chrome)

Copy everything below the line into your local Claude. It needs the Claude in Chrome
extension connected and Chrome signed in to the YouTube account that owns
@AIVideoProductionEditor.

---

Upload my tutorial video to YouTube with full SEO. Use Claude in Chrome (my real Chrome, where I am already signed in to YouTube). Work step by step and verify each field after you fill it in.

**Files**

1. In my local clone of `LudwigKienle/ai-video-production-editor`, run `git fetch origin claude/relaxed-bardeen-cr2svx` and `git checkout origin/claude/relaxed-bardeen-cr2svx -- tutorials/first-10-minutes/youtube`. If I have no local clone, clone the repo first (`git clone https://github.com/LudwigKienle/ai-video-production-editor`) and check out that branch.
2. The folder `tutorials/first-10-minutes/youtube/` now holds:
   - `README.md`: title, description with chapters, tags and settings. Copy the text from it exactly; don't rewrite it.
   - `thumbnail.jpg`: the thumbnail (1280×720).
   - `captions.srt`: English subtitles.
3. The video itself is `tutorial-youtube.mp4`, probably in `~/Downloads`. Find it with `find ~/Downloads ~/Desktop -name "tutorial-youtube*.mp4"`. If it isn't there, ask me where it is.

**Upload in YouTube Studio**

1. Call `tabs_context_mcp`, open a new tab and go to https://studio.youtube.com. Check at the top right that the active channel is "AI Video Production Editor". If it isn't, switch to it via the avatar menu ("Switch account").
2. Click "Create" → "Upload videos". Try to put the video file into the file input of the upload dialog (the `input[type=file]` element) with your file-upload tool. If Chrome only opens the native file dialog and you can't control it, stop and tell me: "Please drag tutorial-youtube.mp4 into the open upload window." Then wait until I say it's done.
3. **Details** tab:
   - Title: the main title from README.md.
   - Description: the whole block under "Description" (without the ``` fences). Check that the chapter lines start with `0:00`.
   - Thumbnail: "Upload thumbnail" → `thumbnail.jpg` (same approach as the video; ask me if the file dialog can't be controlled).
   - Playlist: "Tutorials" if it exists, otherwise create it.
   - Audience: "No, it's not made for kids".
   - Click "Show more":
     - Tags: the tag list from README.md (comma-separated).
     - Altered content: "No".
     - Language: English.
     - Caption certification: "This content has never aired on television in the U.S."
     - Category: Science & Technology.
     - Turn on automatic chapters, but the chapters in the description take priority.
4. Subtitles: in the same flow ("Video elements" step, or later under "Subtitles" in the side menu), add "English" → "Upload file" → "With timing" → `captions.srt`.
5. **Video elements:**
   - End screen: "Import from video" if an earlier video has one. Otherwise use the "1 video, 1 subscribe" template with the launch trailer (https://youtu.be/-6jo636vRSw) as the video.
   - Card: at 0:25, linking to the launch trailer.
6. **Checks:** wait until the copyright check is finished and report the result to me.
7. **Visibility:** first select "Private" and click "Save". Then send me the Studio link and a short summary (title, chapters detected yes/no, thumbnail set, subtitles uploaded). **Switch to "Public" only after I explicitly confirm**, or schedule it if I name a time.
8. Afterwards: post a comment under the video with the download link (`⬇️ Download for macOS/Windows: https://github.com/LudwigKienle/ai-video-production-editor/releases/latest`) and pin it. Do this only once the video is public.

**Rules**

- No more than 2–3 attempts per step. If something gets stuck, describe it and ask me.
- Don't click anything that deletes or overwrites existing videos or settings.
- Close only the tabs you opened yourself at the end.
