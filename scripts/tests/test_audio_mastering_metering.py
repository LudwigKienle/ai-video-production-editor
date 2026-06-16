import unittest

import numpy as np

from audio_mastering.metering import measure_integrated_lufs, measure_true_peak_dbtp


class MeteringTest(unittest.TestCase):
    def test_measurements_return_finite_numbers(self):
        sample_rate = 48000
        timeline = np.linspace(0, 2, sample_rate * 2, endpoint=False)
        audio = np.stack([
            0.2 * np.sin(2 * np.pi * 220 * timeline),
            0.2 * np.sin(2 * np.pi * 220 * timeline),
        ], axis=1).astype(np.float32)

        lufs = measure_integrated_lufs(audio, sample_rate)
        true_peak = measure_true_peak_dbtp(audio)

        self.assertTrue(np.isfinite(lufs))
        self.assertTrue(np.isfinite(true_peak))
