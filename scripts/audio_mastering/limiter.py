from __future__ import annotations

import numpy as np

from .metering import db_to_linear, measure_true_peak_dbtp


def apply_true_peak_ceiling(audio: np.ndarray, ceiling_dbtp: float = -1.0) -> np.ndarray:
    limited = audio.astype(np.float32).copy()
    current_peak = measure_true_peak_dbtp(limited)
    if current_peak <= ceiling_dbtp:
      return limited

    gain_linear = db_to_linear(ceiling_dbtp - current_peak)
    limited *= gain_linear
    sample_ceiling = db_to_linear(ceiling_dbtp)
    return np.clip(limited, -sample_ceiling, sample_ceiling).astype(np.float32)
