import unittest

import numpy as np

from audio_mastering.analysis import analyze_frequency_curve, smooth_curve


class SmoothCurveTest(unittest.TestCase):
    def test_smooth_curve_preserves_length(self):
        curve = np.array([0.0, 2.0, -1.0, 3.0, 0.0], dtype=np.float32)
        smoothed = smooth_curve(curve, window_size=3)
        self.assertEqual(len(smoothed), len(curve))

    def test_analyze_frequency_curve_returns_curve_and_bins(self):
        sample_rate = 48000
        timeline = np.linspace(0, 1, sample_rate, endpoint=False)
        audio = np.stack([
            np.sin(2 * np.pi * 440 * timeline),
            np.sin(2 * np.pi * 440 * timeline),
        ], axis=1).astype(np.float32)

        frequencies, curve = analyze_frequency_curve(audio, sample_rate)
        self.assertEqual(len(frequencies), len(curve))
        self.assertGreater(len(curve), 10)
