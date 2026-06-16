from __future__ import annotations

from typing import Any

import librosa
import numpy as np
from scipy import signal

from .analysis import ensure_stereo
from .metering import linear_to_db, measure_integrated_lufs, measure_true_peak_dbtp


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, float(value)))


def _resolve_profile_name(features: dict[str, Any]) -> str:
    voice_ratio = float(features.get("voice_ratio", 0.0) or 0.0)
    crest_factor = float(features.get("crest_factor", 9.0) or 9.0)
    integrated_lufs = float(features.get("integrated_lufs", -18.0) or -18.0)

    if voice_ratio >= 0.72:
        return "spotify_dialog"
    if crest_factor >= 12.0:
        return "spotify_natural"
    if integrated_lufs >= -13.2 or crest_factor <= 6.0:
        return "spotify_loud"
    return "spotify_balanced"


def choose_spotify_profile(features: dict[str, Any], has_reference: bool) -> dict[str, Any]:
    profile = _resolve_profile_name(features)
    stereo_width = float(features.get("stereo_width", 0.45) or 0.45)
    bass_side_ratio = float(features.get("bass_side_ratio", 0.08) or 0.08)

    if profile == "spotify_dialog":
        compression_strength = 4.0
        stereo_width_percent = 76.0
        eq_match_amount = 22.0 if not has_reference else 32.0
        label = "Controlled dialog-forward Spotify master"
    elif profile == "spotify_natural":
        compression_strength = 4.0
        stereo_width_percent = 86.0
        eq_match_amount = 28.0 if not has_reference else 42.0
        label = "More dynamic Spotify master"
    elif profile == "spotify_loud":
        compression_strength = 6.5
        stereo_width_percent = 92.0
        eq_match_amount = 35.0 if not has_reference else 52.0
        label = "Tighter loud Spotify master"
    else:
        compression_strength = 5.0
        stereo_width_percent = 96.0
        eq_match_amount = 30.0 if not has_reference else 48.0
        label = "Balanced Spotify master"

    stereo_width_percent = min(stereo_width_percent, 75.0 + stereo_width * 40.0)
    if bass_side_ratio > 0.18:
        stereo_width_percent -= 10.0

    return {
        "profile": profile,
        "label": label,
        "target_lufs": -14.0,
        "compression_strength": _clamp(compression_strength, 1.0, 10.0),
        "stereo_width_percent": _clamp(stereo_width_percent, 55.0, 100.0),
        "eq_match_amount": _clamp(eq_match_amount, 0.0, 100.0),
        "limiter_ceiling_dbtp": -1.0,
        "low_mid_crossover_hz": 160.0,
        "mid_high_crossover_hz": 3200.0,
        "reference_influence": 0.65 if has_reference else 0.0,
    }


def extract_mastering_features(audio: np.ndarray, sample_rate: int) -> dict[str, Any]:
    stereo_audio = ensure_stereo(audio.astype(np.float32))
    mono = np.mean(stereo_audio, axis=1)

    rms = float(np.sqrt(np.mean(np.square(mono))) + 1e-9)
    peak = float(np.max(np.abs(stereo_audio)) + 1e-9)
    crest_factor = linear_to_db(peak / rms)

    mid = (stereo_audio[:, 0] + stereo_audio[:, 1]) * 0.5
    side = (stereo_audio[:, 0] - stereo_audio[:, 1]) * 0.5
    stereo_width = float(np.mean(np.abs(side)) / (np.mean(np.abs(mid)) + 1e-6))

    freqs = np.fft.rfftfreq(len(mono), d=1.0 / float(sample_rate))
    magnitude = np.abs(np.fft.rfft(mono))
    speech_band_energy = float(np.sum(magnitude[(freqs >= 250.0) & (freqs <= 4000.0)]))
    full_band_energy = float(np.sum(magnitude[(freqs >= 120.0) & (freqs <= 8000.0)])) + 1e-6
    voice_ratio = _clamp((speech_band_energy / full_band_energy) * max(0.0, 1.0 - stereo_width * 1.4), 0.0, 1.0)

    low_sos = signal.butter(4, 160.0, btype="lowpass", fs=sample_rate, output="sos")
    low = signal.sosfiltfilt(low_sos, stereo_audio, axis=0)
    low_mid = (low[:, 0] + low[:, 1]) * 0.5
    low_side = (low[:, 0] - low[:, 1]) * 0.5
    bass_side_ratio = float(np.mean(np.abs(low_side)) / (np.mean(np.abs(low_mid)) + 1e-6))

    spectral_centroid = float(np.mean(librosa.feature.spectral_centroid(y=mono, sr=sample_rate)))

    return {
        "integrated_lufs": float(measure_integrated_lufs(stereo_audio, sample_rate)),
        "true_peak_dbtp": float(measure_true_peak_dbtp(stereo_audio)),
        "crest_factor": crest_factor,
        "stereo_width": _clamp(stereo_width, 0.0, 1.5),
        "voice_ratio": voice_ratio,
        "bass_side_ratio": _clamp(bass_side_ratio, 0.0, 1.0),
        "spectral_centroid": spectral_centroid,
    }


def measure_reference_similarity(target_features: dict[str, Any], reference_features: dict[str, Any]) -> float:
    lufs_delta = min(abs(float(target_features.get("integrated_lufs", -18.0)) - float(reference_features.get("integrated_lufs", -18.0))) / 10.0, 1.0)
    width_delta = min(abs(float(target_features.get("stereo_width", 0.3)) - float(reference_features.get("stereo_width", 0.3))) / 0.8, 1.0)
    centroid_delta = min(abs(float(target_features.get("spectral_centroid", 1200.0)) - float(reference_features.get("spectral_centroid", 1200.0))) / 2500.0, 1.0)

    score = 1.0 - ((lufs_delta * 0.4) + (width_delta * 0.3) + (centroid_delta * 0.3))
    return _clamp(score, 0.0, 1.0)
