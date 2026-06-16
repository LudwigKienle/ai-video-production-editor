import unittest

import numpy as np

from audio_mastering.limiter import apply_true_peak_ceiling
from audio_mastering.metering import measure_true_peak_dbtp


class LimiterTest(unittest.TestCase):
    def test_apply_true_peak_ceiling_constrains_true_peak(self):
        audio = np.array([[1.5, -1.5], [0.8, -0.8], [1.2, -1.2]], dtype=np.float32)
        limited = apply_true_peak_ceiling(audio, ceiling_dbtp=-1.0)
        self.assertLessEqual(measure_true_peak_dbtp(limited), -0.95)
