from __future__ import annotations

import numpy as np
from scipy import signal

from .analysis import ensure_stereo


def apply_stereo_width(audio: np.ndarray, sample_rate: int, width_percent: float) -> np.ndarray:
    stereo_audio = ensure_stereo(audio.astype(np.float32))
    low_sos = signal.butter(4, 160, btype="lowpass", fs=sample_rate, output="sos")
    high_sos = signal.butter(4, 160, btype="highpass", fs=sample_rate, output="sos")

    low = signal.sosfiltfilt(low_sos, stereo_audio, axis=0)
    high = signal.sosfiltfilt(high_sos, stereo_audio, axis=0)

    low_mono = np.mean(low, axis=1, keepdims=True)
    low_stereo = np.repeat(low_mono, 2, axis=1)

    mid = (high[:, 0] + high[:, 1]) * 0.5
    side = (high[:, 0] - high[:, 1]) * 0.5
    side *= max(0.0, float(width_percent)) / 100.0

    widened = np.stack([mid + side, mid - side], axis=1)
    return (low_stereo + widened).astype(np.float32)
