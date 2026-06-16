from __future__ import annotations

import numpy as np
from scipy import signal

from .analysis import analyze_frequency_curve, ensure_stereo, smooth_curve


def build_eq_match_curve(
    target_audio: np.ndarray,
    reference_audio: np.ndarray,
    sample_rate: int,
    amount: float = 100.0,
) -> tuple[np.ndarray, np.ndarray]:
    frequencies, target_curve = analyze_frequency_curve(target_audio, sample_rate)
    _, reference_curve = analyze_frequency_curve(reference_audio, sample_rate)
    target_db = 20.0 * np.log10(np.maximum(target_curve, 1e-8))
    reference_db = 20.0 * np.log10(np.maximum(reference_curve, 1e-8))
    delta_db = smooth_curve(reference_db - target_db, window_size=51)
    scaled_delta = np.clip(delta_db * (max(0.0, float(amount)) / 100.0), -6.0, 6.0)
    return frequencies.astype(np.float32), scaled_delta.astype(np.float32)


def apply_eq_match(
    audio: np.ndarray,
    reference_audio: np.ndarray,
    sample_rate: int,
    amount: float = 100.0,
) -> np.ndarray:
    stereo_audio = ensure_stereo(audio.astype(np.float32))
    frequencies, delta_db = build_eq_match_curve(stereo_audio, reference_audio, sample_rate, amount=amount)
    normalized_frequencies = frequencies / max(float(sample_rate) * 0.5, 1.0)
    normalized_frequencies[0] = 0.0
    normalized_frequencies[-1] = 1.0
    gains = np.power(10.0, delta_db / 20.0)
    taps = signal.firwin2(257, normalized_frequencies, gains, window="hann")
    processed = np.zeros_like(stereo_audio)
    for channel_index in range(stereo_audio.shape[1]):
        processed[:, channel_index] = signal.filtfilt(taps, [1.0], stereo_audio[:, channel_index])
    peak = float(np.max(np.abs(processed)))
    if peak > 1.0:
        processed /= peak
    return processed.astype(np.float32)
