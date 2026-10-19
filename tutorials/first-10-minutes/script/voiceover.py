#!/usr/bin/env python3
"""Narration for the tutorial: one ElevenLabs v4 call per scene, with word timestamps.

    export ELEVENLABS_API_KEY=...            # never commit it, never paste it into chat
    python3 script/voiceover.py --list-voices "narrator"
    python3 script/voiceover.py --voice <voice_id>            # all scenes
    python3 script/voiceover.py --voice <voice_id> s03_onboarding s06_script
    python3 script/voiceover.py --estimate                    # no API: timing preview only

Output per scene:
    build/audio/<scene>.mp3
    build/timings/<scene>.json  {"scene", "duration", "estimated", "words": [{"word", "start", "end"}]}

Estimated timings (156 wpm, pauses at punctuation) let the recorder and the edit be
built before the real voice exists. They are flagged "estimated": true and must be
replaced by real timings before the final recording.
"""
import argparse
import base64
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCENES = json.loads((ROOT / "script/scenes.json").read_text())
AUDIO = ROOT / "build/audio"
TIMINGS = ROOT / "build/timings"
API = "https://api.elevenlabs.io"


def api(path, body=None):
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        sys.exit("Set ELEVENLABS_API_KEY in the environment.")
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"xi-api-key": key, "Content-Type": "application/json"},
        method="POST" if body is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=180) as res:
        return json.loads(res.read())


def words_from_alignment(alignment):
    """Group ElevenLabs character timings into words (punctuation stays attached)."""
    chars = alignment["characters"]
    starts = alignment["character_start_times_seconds"]
    ends = alignment["character_end_times_seconds"]
    words, current = [], None
    for ch, start, end in zip(chars, starts, ends):
        if ch.isspace():
            if current:
                words.append(current)
                current = None
            continue
        if current is None:
            current = {"word": ch, "start": start, "end": end}
        else:
            current["word"] += ch
            current["end"] = end
    if current:
        words.append(current)
    return [{**w, "start": round(w["start"], 3), "end": round(w["end"], 3)} for w in words]


def estimate(text):
    """156 wpm with extra time after punctuation. A preview, not a measurement."""
    t, words = 0.0, []
    for token in text.split():
        core = re.sub(r"[^\w']", "", token)
        dur = 0.12 + 0.045 * len(core)
        words.append({"word": token, "start": round(t, 3), "end": round(t + dur, 3)})
        t += dur + 0.03
        if token.endswith((".", "!", "?")):
            t += 0.3
        elif token.endswith((",", ":", ";")):
            t += 0.12
    return words


def synthesize(scene, index, voice_id):
    scenes = SCENES["scenes"]
    body = {
        "text": scene["text"],
        "model_id": SCENES["voice"]["model_id"],
        "language_code": SCENES["voice"]["language_code"],
        # Neighbouring text keeps intonation consistent across separate calls.
        "previous_text": scenes[index - 1]["text"] if index > 0 else None,
        "next_text": scenes[index + 1]["text"] if index + 1 < len(scenes) else None,
    }
    # Pay-as-you-go plans allow at most mp3_44100_128.
    result = api(f"/v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128", body)
    (AUDIO / f"{scene['id']}.mp3").write_bytes(base64.b64decode(result["audio_base64"]))
    return words_from_alignment(result.get("normalized_alignment") or result["alignment"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("scenes", nargs="*", help="scene ids (default: all)")
    parser.add_argument("--voice", help="ElevenLabs voice id")
    parser.add_argument("--estimate", action="store_true", help="write estimated timings, no API call")
    parser.add_argument("--list-voices", metavar="QUERY", help="search the voice library")
    args = parser.parse_args()

    if args.list_voices is not None:
        res = api(f"/v1/shared-voices?page_size=20&language=en&search={urllib.parse.quote(args.list_voices)}")
        for v in res.get("voices", []):
            print(f"{v['voice_id']}  {v['name']}  [{v.get('accent', '')}, {v.get('age', '')}, {v.get('use_case', '')}]")
        return

    AUDIO.mkdir(parents=True, exist_ok=True)
    TIMINGS.mkdir(parents=True, exist_ok=True)
    wanted = set(args.scenes)
    for index, scene in enumerate(SCENES["scenes"]):
        if wanted and scene["id"] not in wanted:
            continue
        if args.estimate:
            words = estimate(scene["text"])
        else:
            if not args.voice:
                sys.exit("--voice is required unless --estimate is given.")
            words = synthesize(scene, index, args.voice)
        out = {"scene": scene["id"], "duration": words[-1]["end"], "estimated": args.estimate, "words": words}
        (TIMINGS / f"{scene['id']}.json").write_text(json.dumps(out, indent=1))
        print(f"{scene['id']}: {len(words)} words, {out['duration']:.2f} s{' (estimated)' if args.estimate else ''}")


if __name__ == "__main__":
    import urllib.parse  # noqa: E402  (used by --list-voices)
    main()
