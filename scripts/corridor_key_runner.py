from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path


def _find_first_file(directory: Path, suffixes: tuple[str, ...]) -> Path | None:
    if not directory.exists():
        return None
    for item in sorted(directory.iterdir()):
        if item.is_file() and item.suffix.lower() in suffixes:
            return item
    return None


def _emit(payload: dict) -> None:
    print(json.dumps(payload), flush=True)


def main() -> int:
    if len(sys.argv) < 2:
        _emit({"ok": False, "error": "Missing CorridorKey job config path."})
        return 2

    config_path = Path(sys.argv[1]).expanduser().resolve()
    try:
        config = json.loads(config_path.read_text("utf8"))
        repo_path = Path(config["repoPath"]).expanduser().resolve()
        clip_root = Path(config["clipRoot"]).expanduser().resolve()
        clip_name = str(config["clipName"])
        options = config.get("options") or {}

        os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
        os.chdir(repo_path)
        sys.path.insert(0, str(repo_path))

        from clip_manager import ClipEntry, InferenceSettings, run_inference

        clip = ClipEntry(clip_name, str(clip_root))
        clip.find_assets()
        clip.validate_pair()

        settings = InferenceSettings(
            input_is_linear=options.get("inputColorSpace") == "linear",
            despill_strength=float(options.get("despill", 5)) / 10.0,
            auto_despeckle=options.get("autoDespeckle", True),
            despeckle_size=int(options.get("despeckleSize", 400)),
            refiner_scale=float(options.get("refiner", 1.0)),
            generate_comp=options.get("generateComp", True),
            gpu_post_processing=options.get("gpuPost", False),
            image_size=int(options.get("imageSize", 2048)),
            tiled_inference=options.get("tiledInference", False),
        )

        device = options.get("device")
        backend = options.get("backend")
        max_frames = options.get("maxFrames")
        run_inference(
            [clip],
            device=None if device in (None, "auto") else device,
            backend=None if backend in (None, "auto") else backend,
            max_frames=max_frames,
            skip_existing=False,
            settings=settings,
        )

        output_root = clip_root / "Output"
        comp_video = output_root / f"{clip_name}_comp.mp4"
        comp_image = _find_first_file(output_root / "Comp", (".png", ".jpg", ".jpeg"))

        output_path: Path | None = None
        media_type = "folder"
        if comp_video.exists():
            output_path = comp_video
            media_type = "video"
        elif comp_image:
            output_path = comp_image
            media_type = "image"

        _emit(
            {
                "ok": True,
                "outputPath": str(output_path) if output_path else None,
                "outputName": output_path.name if output_path else output_root.name,
                "outputFolder": str(output_root),
                "mediaType": media_type,
            }
        )
        return 0
    except Exception as error:
        traceback.print_exc()
        _emit({"ok": False, "error": str(error)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
