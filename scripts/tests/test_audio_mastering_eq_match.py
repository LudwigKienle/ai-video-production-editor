import unittest

import numpy as np

from audio_mastering.eq_match import apply_eq_match


class EqMatchTest(unittest.TestCase):
    def test_apply_eq_match_avoids_excessive_peak_explosion(self):
        sample_rate = 48000
        timeline = np.linspace(0, 2, sample_rate * 2, endpoint=False)
        target = np.stack([
            0.18 * np.sin(2 * np.pi * 220 * timeline) + 0.06 * np.sin(2 * np.pi * 1800 * timeline),
            0.16 * np.sin(2 * np.pi * 220 * timeline) + 0.05 * np.sin(2 * np.pi * 2200 * timeline),
        ], axis=1).astype(np.float32)
        reference = np.stack([
            0.24 * np.sin(2 * np.pi * 110 * timeline) + 0.08 * np.sin(2 * np.pi * 3200 * timeline),
            0.20 * np.sin(2 * np.pi * 110 * timeline) + 0.12 * np.sin(2 * np.pi * 4100 * timeline),
        ], axis=1).astype(np.float32)

        processed = apply_eq_match(target, reference, sample_rate, amount=85)
        self.assertLess(np.max(np.abs(processed)), 1.5)
