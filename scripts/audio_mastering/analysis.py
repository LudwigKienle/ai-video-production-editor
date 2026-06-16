from __future__ import annotations

import numpy as np
import librosa


def ensure_stereo(audio: np.ndarray) -> np.ndarray:
    if audio.ndim == 1:
        return np.stack([audio, audio], axis=1)
    if audio.shape[1] == 1:
        return np.repeat(audio, 2, axis=1)
    return audio


def smooth_curve(curve: np.ndarray, window_size: int = 31) -> np.ndarray:
    normalized_window = max(1, int(window_size))
    kernel = np.ones(normalized_window, dtype=np.float32) / float(normalized_window)
    return np.convolve(curve.astype(np.float32), kernel, mode="same")


def analyze_frequency_curve(
    audio: np.ndarray,
    sample_rate: int,
    n_fft: int = 4096,
    hop_length: int = 1024,
) -> tuple[np.ndarray, np.ndarray]:
    stereo_audio = ensure_stereo(audio.astype(np.float32))
    mono = np.mean(stereo_audio, axis=1)
    stft = librosa.stft(mono, n_fft=n_fft, hop_length=hop_length)
    magnitude = np.abs(stft)
    average_curve = np.mean(magnitude, axis=1)
    smoothed = smooth_curve(average_curve, window_size=31)
    freqs = librosa.fft_frequencies(sr=sample_rate, n_fft=n_fft)
    return freqs.astype(np.float32), smoothed.astype(np.float32)
