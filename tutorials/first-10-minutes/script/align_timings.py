#!/usr/bin/env python3
"""Map word timestamps from a transcript of the narration onto the script's own words.

Used when the narration comes from the ElevenLabs connector (speech + Scribe transcript)
instead of the /with-timestamps API. The transcript can spell things differently
("twenty-two" vs "22", "npm" vs "NPM"), so words are matched by sequence alignment and
unmatched script words get times interpolated between their matched neighbours.

    python3 script/align_timings.py s01_intro       # build/transcripts/s01_intro.json → build/timings/s01_intro.json
    python3 script/align_timings.py                 # every scene with a transcript

Transcript file: {"words": [{"text"|"word": str, "start": float, "end": float}, ...]}
"""
import difflib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCENES = {s["id"]: s for s in json.loads((ROOT / "script/scenes.json").read_text())["scenes"]}


def norm(word):
    return re.sub(r"[^a-z0-9]", "", word.lower())


def audio_duration(scene_id):
    mp3 = ROOT / f"build/audio/{scene_id}.mp3"
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp3)],
                         capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def align(scene_id):
    transcript = json.loads((ROOT / f"build/transcripts/{scene_id}.json").read_text())
    heard = [w for w in transcript["words"] if norm(w.get("text") or w.get("word") or "")]
    heard = [{"w": norm(w.get("text") or w.get("word")), "start": float(w["start"]), "end": float(w["end"])} for w in heard]
    script_words = SCENES[scene_id]["text"].split()
    # Hyphenated script words ("open-source", "twenty-two") are often two transcript words.
    keys = [norm(w) for w in script_words]
    joined = [h["w"] for h in heard]

    times = [None] * len(script_words)
    matcher = difflib.SequenceMatcher(a=keys, b=joined, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                times[i1 + k] = (heard[j1 + k]["start"], heard[j1 + k]["end"])
        elif tag == "replace" and j2 > j1:
            # Spread the heard span over the script span (e.g. "opensource" vs "open","source").
            start, end = heard[j1]["start"], heard[j2 - 1]["end"]
            n = i2 - i1
            for k in range(n):
                times[i1 + k] = (start + (end - start) * k / n, start + (end - start) * (k + 1) / n)

    # Interpolate anything still unmatched between known neighbours.
    total = audio_duration(scene_id)
    for i, t in enumerate(times):
        if t is not None:
            continue
        prev_end = next((times[j][1] for j in range(i - 1, -1, -1) if times[j]), 0.0)
        nxt = next((j for j in range(i + 1, len(times)) if times[j]), None)
        next_start = times[nxt][0] if nxt is not None else total
        gap = nxt - i if nxt is not None else len(times) - i
        step = max(next_start - prev_end, 0.05) / (gap + 1)
        times[i] = (prev_end + step * 0.1, prev_end + step)

    words = [{"word": w, "start": round(s, 3), "end": round(max(e, s + 0.04), 3)} for w, (s, e) in zip(script_words, times)]
    matched = sum(1 for tag in matcher.get_opcodes() if tag[0] == "equal")
    out = {"scene": scene_id, "duration": round(max(words[-1]["end"], 0.0), 3), "estimated": False,
           "audio_duration": round(total, 3), "source": "elevenlabs-scribe", "words": words}
    (ROOT / "build/timings").mkdir(parents=True, exist_ok=True)
    (ROOT / f"build/timings/{scene_id}.json").write_text(json.dumps(out, indent=1))
    ratio = matcher.ratio()
    print(f"{scene_id}: {len(words)} words, last word ends {out['duration']:.2f} s of {total:.2f} s, match {ratio:.0%}")


if __name__ == "__main__":
    ids = sys.argv[1:] or sorted(p.stem for p in (ROOT / "build/transcripts").glob("*.json"))
    for scene_id in ids:
        align(scene_id)
