from __future__ import annotations

from typing import Any


def validate_master(metrics: dict[str, Any], target_lufs: float, ceiling_dbtp: float) -> dict[str, Any]:
    after_lufs = float(metrics.get("after_lufs", 0.0) or 0.0)
    after_true_peak = float(metrics.get("after_true_peak_dbtp", 0.0) or 0.0)
    stereo_width_percent = float(metrics.get("stereo_width_percent", 0.0) or 0.0)
    bass_side_ratio = float(metrics.get("bass_side_ratio", 0.0) or 0.0)

    issues: list[str] = []
    warnings: list[str] = []

    if after_true_peak > ceiling_dbtp:
        issues.append("true_peak")
        warnings.append("True peak exceeds the Spotify-safe ceiling.")
    if abs(after_lufs - target_lufs) > 0.7:
        issues.append("lufs")
        warnings.append("Integrated loudness is outside the Spotify target window.")
    if stereo_width_percent > 108.0:
        issues.append("stereo_width")
        warnings.append("Stereo width is too aggressive for a Spotify-safe auto master.")
    if bass_side_ratio > 0.2:
        issues.append("bass_width")
        warnings.append("Low-end stereo spread is too wide.")

    return {
        "spotify_ready": not issues,
        "issues": issues,
        "warnings": warnings,
        "target_lufs": float(target_lufs),
        "ceiling_dbtp": float(ceiling_dbtp),
        "after_lufs": after_lufs,
        "after_true_peak_dbtp": after_true_peak,
    }


def should_run_correction_pass(report: dict[str, Any]) -> bool:
    return bool(report.get("issues"))
