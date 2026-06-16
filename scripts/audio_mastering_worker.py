from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from audio_mastering.analysis import ensure_stereo
from audio_mastering.auto_profile import (
    choose_spotify_profile,
    extract_mastering_features,
    measure_reference_similarity,
)
from audio_mastering.eq_match import apply_eq_match
from audio_mastering.limiter import apply_true_peak_ceiling
from audio_mastering.metering import (
    measure_integrated_lufs,
    measure_true_peak_dbtp,
    normalize_to_lufs,
)
from audio_mastering.multiband import apply_multiband_compression
from audio_mastering.stereo import apply_stereo_width
from audio_mastering.validation import should_run_correction_pass, validate_master


def build_processing_plan() -> list[str]:
    return [
        "decode",
        "analyze",
        "eq_match",
        "multiband_compress",
        "stereo_image",
        "loudness_normalize",
        "limit",
        "export",
    ]


def _load_audio(file_path: str, sample_rate: int = 48000) -> tuple[np.ndarray, dict]:
    audio, detected_sample_rate = sf.read(file_path, always_2d=True, dtype="float32")
    source_channels = int(audio.shape[1]) if audio.ndim > 1 else 1
    if detected_sample_rate != sample_rate:
        channels = []
        for channel_index in range(audio.shape[1]):
            channels.append(librosa.resample(audio[:, channel_index], orig_sr=detected_sample_rate, target_sr=sample_rate))
        audio = np.stack(channels, axis=1)
    return ensure_stereo(audio.astype(np.float32)), {
        "source_channels": source_channels,
        "sample_rate": sample_rate,
    }


def _emit(log_lines: list[str], stage: str, message: str) -> None:
    log_lines.append(f"{stage}: {message}")


def _build_manual_settings(config: dict) -> dict:
    advanced = config.get("advanced") or {}
    return {
        "profile": "manual",
        "label": "Manual mastering",
        "target_lufs": float(config.get("targetLufs", -14)),
        "compression_strength": float(config.get("compressionStrength", 5)),
        "stereo_width_percent": float(config.get("stereoWidthPercent", 100)),
        "eq_match_amount": float(advanced.get("eqMatchAmount", 100)),
        "limiter_ceiling_dbtp": float(advanced.get("limiterCeilingDbtp", -1)),
        "low_mid_crossover_hz": float(advanced.get("lowMidCrossoverHz", 160)),
        "mid_high_crossover_hz": float(advanced.get("midHighCrossoverHz", 3200)),
    }


def _build_auto_settings(
    config: dict,
    target_audio: np.ndarray,
    reference_audio: np.ndarray | None,
    sample_rate: int,
    warnings: list[str],
) -> dict:
    target_features = extract_mastering_features(target_audio, sample_rate)
    profile = choose_spotify_profile(target_features, has_reference=reference_audio is not None)
    settings = dict(profile)

    if reference_audio is not None:
        reference_features = extract_mastering_features(reference_audio, sample_rate)
        similarity = measure_reference_similarity(target_features, reference_features)
        settings["reference_similarity"] = similarity
        if similarity < 0.55:
            settings["eq_match_amount"] *= 0.65
            warnings.append("Reference influence was reduced because the source and reference differ strongly.")
        if similarity < 0.35:
            settings["stereo_width_percent"] = min(settings["stereo_width_percent"], 88.0)
    else:
        settings["eq_match_amount"] = 0.0

    advanced = config.get("advanced") or {}
    if advanced.get("lowMidCrossoverHz") is not None:
        settings["low_mid_crossover_hz"] = float(advanced["lowMidCrossoverHz"])
    if advanced.get("midHighCrossoverHz") is not None:
        settings["mid_high_crossover_hz"] = float(advanced["midHighCrossoverHz"])
    if advanced.get("limiterCeilingDbtp") is not None:
        settings["limiter_ceiling_dbtp"] = float(advanced["limiterCeilingDbtp"])

    return settings


def _render_mastering_pass(
    target_audio: np.ndarray,
    reference_audio: np.ndarray | None,
    sample_rate: int,
    settings: dict,
    log_lines: list[str],
    pass_label: str,
) -> tuple[np.ndarray, dict]:
    processed = target_audio
    reference_signal = reference_audio if reference_audio is not None else target_audio

    eq_amount = float(settings.get("eq_match_amount", 0.0))
    if eq_amount > 0.01:
        processed = apply_eq_match(
            target_audio,
            reference_signal,
            sample_rate,
            amount=eq_amount,
        )
        _emit(log_lines, "eq_match", f"{pass_label}: Applied FFT-based EQ matching at {eq_amount:.1f}%")
    else:
        _emit(log_lines, "eq_match", f"{pass_label}: Skipped EQ matching")

    processed = apply_multiband_compression(
        processed,
        sample_rate,
        compression_strength=float(settings.get("compression_strength", 5)),
        low_mid_hz=float(settings.get("low_mid_crossover_hz", 160)),
        mid_high_hz=float(settings.get("mid_high_crossover_hz", 3200)),
    )
    _emit(log_lines, "multiband_compress", f"{pass_label}: Applied multiband compression")

    processed = apply_stereo_width(
        processed,
        sample_rate,
        width_percent=float(settings.get("stereo_width_percent", 100)),
    )
    _emit(log_lines, "stereo_image", f"{pass_label}: Applied stereo width processing")

    processed = normalize_to_lufs(processed, sample_rate, float(settings.get("target_lufs", -14)))
    _emit(log_lines, "loudness_normalize", f"{pass_label}: Normalized integrated loudness")

    ceiling = float(settings.get("limiter_ceiling_dbtp", -1))
    processed = apply_true_peak_ceiling(processed, ceiling_dbtp=ceiling)
    _emit(log_lines, "limit", f"{pass_label}: Applied true peak ceiling")

    metrics = extract_mastering_features(processed, sample_rate)
    metrics.update(
        {
            "after_lufs": float(measure_integrated_lufs(processed, sample_rate)),
            "after_true_peak_dbtp": float(measure_true_peak_dbtp(processed)),
            "stereo_width_percent": float(settings.get("stereo_width_percent", 100)),
        }
    )
    return processed, metrics


def _build_correction_settings(settings: dict, validation_report: dict) -> dict:
    corrected = dict(settings)
    issues = set(validation_report.get("issues") or [])

    if "lufs" in issues:
        delta = float(validation_report.get("target_lufs", -14.0)) - float(validation_report.get("after_lufs", -14.0))
        corrected["target_lufs"] = float(corrected.get("target_lufs", -14.0)) + max(min(delta, 1.5), -1.5)
    if "true_peak" in issues:
        corrected["limiter_ceiling_dbtp"] = min(float(corrected.get("limiter_ceiling_dbtp", -1.0)), -1.2)
    if "stereo_width" in issues or "bass_width" in issues:
        corrected["stereo_width_percent"] = max(70.0, float(corrected.get("stereo_width_percent", 100.0)) - 12.0)
    if issues:
        corrected["eq_match_amount"] = max(0.0, float(corrected.get("eq_match_amount", 0.0)) * 0.9)
    return corrected


def process_mastering_job(config: dict) -> dict:
    sample_rate = 48000
    log_lines: list[str] = []
    warnings: list[str] = []
    mode = str(config.get("mode") or "manual")

    target_audio, target_meta = _load_audio(config["targetPath"], sample_rate=sample_rate)
    reference_audio = None
    reference_meta = None
    reference_path = config.get("referencePath")
    if reference_path:
        reference_audio, reference_meta = _load_audio(reference_path, sample_rate=sample_rate)
    _emit(log_lines, "decode", "Loaded and normalized inputs")

    before_lufs = measure_integrated_lufs(target_audio, sample_rate)
    before_true_peak = measure_true_peak_dbtp(target_audio)
    _emit(log_lines, "analyze", "Measured input loudness and peaks")

    if mode == "spotify_auto":
        settings = _build_auto_settings(config, target_audio, reference_audio, sample_rate, warnings)
        auto_profile = settings["profile"]
        _emit(log_lines, "analyze", f"Selected Spotify auto profile: {auto_profile}")
    else:
        settings = _build_manual_settings(config)
        auto_profile = None

    processed, after_metrics = _render_mastering_pass(
        target_audio,
        reference_audio,
        sample_rate,
        settings,
        log_lines,
        "Pass 1",
    )

    validation_report = validate_master(
        after_metrics,
        target_lufs=float(settings.get("target_lufs", config.get("targetLufs", -14))),
        ceiling_dbtp=float(settings.get("limiter_ceiling_dbtp", -1.0)),
    )

    correction_applied = False
    if mode == "spotify_auto" and should_run_correction_pass(validation_report):
        correction_applied = True
        settings = _build_correction_settings(settings, validation_report)
        warnings.append("A corrective Spotify safety pass was applied.")
        processed, after_metrics = _render_mastering_pass(
            target_audio,
            reference_audio,
            sample_rate,
            settings,
            log_lines,
            "Correction pass",
        )
        validation_report = validate_master(
            after_metrics,
            target_lufs=float(settings.get("target_lufs", -14.0)),
            ceiling_dbtp=float(settings.get("limiter_ceiling_dbtp", -1.0)),
        )

    after_lufs = float(after_metrics["after_lufs"])
    after_true_peak = float(after_metrics["after_true_peak_dbtp"])
    ceiling = float(settings.get("limiter_ceiling_dbtp", -1.0))

    if after_true_peak > ceiling + 0.15:
        warnings.append("Final true peak is slightly above the requested ceiling.")
    if abs(after_lufs - float(settings.get("target_lufs", config.get("targetLufs", -14)))) > 1.2:
        warnings.append("Final LUFS is outside the ideal target tolerance.")
    if target_meta["source_channels"] == 1 or (reference_meta and reference_meta["source_channels"] == 1):
        warnings.append("Mono input was converted to stereo.")
    warnings.extend(validation_report.get("warnings") or [])

    output_path = Path(config["outputPath"]).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_path), processed, sample_rate, subtype="PCM_24")
    _emit(log_lines, "export", "Wrote mastered_24bit WAV")

    return {
        "ok": True,
        "outputPath": str(output_path),
        "beforeLufs": float(before_lufs),
        "afterLufs": float(after_lufs),
        "beforeTruePeakDbtp": float(before_true_peak),
        "afterTruePeakDbtp": float(after_true_peak),
        "spotifyReady": bool(validation_report.get("spotify_ready")) if mode == "spotify_auto" else None,
        "autoProfile": auto_profile,
        "warnings": warnings,
        "processingSummary": (
            f"{settings.get('label', 'Mastering')} with EQ match, multiband compression, stereo imaging, "
            f"loudness normalization, and true peak limiting applied."
        ),
        "logLines": log_lines[-200:],
        "correctionApplied": correction_applied,
    }


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: audio_mastering_worker.py <config.json>"}), file=sys.stderr)
        return 1

    config_path = Path(sys.argv[1]).expanduser().resolve()
    try:
        payload = json.loads(config_path.read_text(encoding="utf-8"))
        print(json.dumps(process_mastering_job(payload)))
        return 0
    except Exception as error:  # pragma: no cover - runtime bridge
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": str(error),
                    "traceback": traceback.format_exc(),
                }
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
