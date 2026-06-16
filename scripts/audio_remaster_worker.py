from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

import matchering as mg


def main() -> int:
    if len(sys.argv) < 2:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "Usage: audio_remaster_worker.py <config.json>",
                    "logLines": [],
                }
            ),
            file=sys.stderr,
        )
        return 1

    config_path = Path(sys.argv[1]).expanduser().resolve()
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    log_lines: list[str] = []

    def append_log(*parts: object) -> None:
        message = " ".join(str(part) for part in parts).strip()
        if message:
            log_lines.append(message)

    mg.log(info_handler=append_log, warning_handler=append_log, debug_handler=append_log)

    output_path = Path(payload["outputPath"]).expanduser().resolve()
    preview_path_raw = payload.get("previewPath")
    preview_path = Path(preview_path_raw).expanduser().resolve() if preview_path_raw else None

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if preview_path:
        preview_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        results = [mg.pcm16(str(output_path))]
        kwargs = {}
        if preview_path:
            kwargs["preview_result"] = mg.pcm16(str(preview_path))

        mg.process(
            target=str(Path(payload["targetPath"]).expanduser().resolve()),
            reference=str(Path(payload["referencePath"]).expanduser().resolve()),
            results=results,
            **kwargs,
        )

        print(
            json.dumps(
                {
                    "ok": True,
                    "outputPath": str(output_path),
                    "previewPath": str(preview_path) if preview_path else None,
                    "logLines": log_lines[-200:],
                }
            )
        )
        return 0
    except Exception as error:  # pragma: no cover - runtime bridge
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": str(error),
                    "traceback": traceback.format_exc(),
                    "logLines": log_lines[-200:],
                }
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
