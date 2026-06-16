from __future__ import annotations

import numpy as np
from scipy import signal

from .analysis import ensure_stereo


def _band_sos(sample_rate: int, low_mid_hz: float, mid_high_hz: float):
    low = signal.butter(4, low_mid_hz, btype="lowpass", fs=sample_rate, output="sos")
    mid = signal.butter(
        4,
        [low_mid_hz, mid_high_hz],
        btype="bandpass",
        fs=sample_rate,
        output="sos",
    )
    high = signal.butter(4, mid_high_hz, btype="highpass", fs=sample_rate, output="sos")
    return low, mid, high


def split_bands(
    audio: np.ndarray,
    sample_rate: int,
    low_mid_hz: float = 160.0,
    mid_high_hz: float = 3200.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    stereo_audio = ensure_stereo(audio.astype(np.float32))
    low_sos, mid_sos, high_sos = _band_sos(sample_rate, low_mid_hz, mid_high_hz)
    low = signal.sosfiltfilt(low_sos, stereo_audio, axis=0)
    mid = signal.sosfiltfilt(mid_sos, stereo_audio, axis=0)
    high = signal.sosfiltfilt(high_sos, stereo_audio, axis=0)
    return low.astype(np.float32), mid.astype(np.float32), high.astype(np.float32)


def recombine_bands(low: np.ndarray, mid: np.ndarray, high: np.ndarray) -> np.ndarray:
    return (low + mid + high).astype(np.float32)


def _compress_band(band: np.ndarray, strength: float) -> np.ndarray:
    absolute = np.abs(band)
    envelope = signal.lfilter([0.02], [1.0, -0.98], absolute, axis=0)
    threshold = 0.35 - (float(strength) - 1.0) * 0.02
    ratio = 1.2 + float(strength) * 0.25
    threshold = max(0.08, threshold)

    over = np.maximum(envelope - threshold, 0.0)
    gain = 1.0 / (1.0 + over * ratio)
    makeup = 1.0 + (float(strength) - 1.0) * 0.03
    return (band * gain * makeup).astype(np.float32)


def apply_multiband_compression(
    audio: np.ndarray,
    sample_rate: int,
    compression_strength: float,
    low_mid_hz: float = 160.0,
    mid_high_hz: float = 3200.0,
) -> np.ndarray:
    low, mid, high = split_bands(audio, sample_rate, low_mid_hz=low_mid_hz, mid_high_hz=mid_high_hz)
    compressed_low = _compress_band(low, compression_strength * 0.9)
    compressed_mid = _compress_band(mid, compression_strength)
    compressed_high = _compress_band(high, compression_strength * 1.1)
    return recombine_bands(compressed_low, compressed_mid, compressed_high)
