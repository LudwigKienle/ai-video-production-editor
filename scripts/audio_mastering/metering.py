from __future__ import annotations

import math

import numpy as np
import pyloudnorm as pyln
from scipy import signal

from .analysis import ensure_stereo


def measure_integrated_lufs(audio: np.ndarray, sample_rate: int) -> float:
    stereo_audio = ensure_stereo(audio.astype(np.float32))
    meter = pyln.Meter(sample_rate)
    return float(meter.integrated_loudness(stereo_audio))


def db_to_linear(db_value: float) -> float:
    return float(10 ** (db_value / 20.0))


def linear_to_db(value: float) -> float:
    safe_value = max(float(value), 1e-12)
    return float(20.0 * math.log10(safe_value))


def measure_true_peak_dbtp(audio: np.ndarray, oversample_factor: int = 4) -> float:
    stereo_audio = ensure_stereo(audio.astype(np.float32))
    oversampled = signal.resample_poly(stereo_audio, oversample_factor, 1, axis=0)
    peak = float(np.max(np.abs(oversampled)))
    return linear_to_db(peak)


def normalize_to_lufs(audio: np.ndarray, sample_rate: int, target_lufs: float) -> np.ndarray:
    current_lufs = measure_integrated_lufs(audio, sample_rate)
    gain_db = target_lufs - current_lufs
    gain_linear = db_to_linear(gain_db)
    return (audio * gain_linear).astype(np.float32)
