import unittest

import numpy as np

from audio_mastering.multiband import recombine_bands, split_bands


class MultibandTest(unittest.TestCase):
    def test_split_and_recombine_preserve_shape(self):
        sample_rate = 48000
        timeline = np.linspace(0, 1, sample_rate, endpoint=False)
        audio = np.stack([
            0.3 * np.sin(2 * np.pi * 80 * timeline)
            + 0.2 * np.sin(2 * np.pi * 1200 * timeline)
            + 0.15 * np.sin(2 * np.pi * 6000 * timeline),
            0.3 * np.sin(2 * np.pi * 80 * timeline)
            + 0.2 * np.sin(2 * np.pi * 1200 * timeline)
            + 0.15 * np.sin(2 * np.pi * 6000 * timeline),
        ], axis=1).astype(np.float32)

        low, mid, high = split_bands(audio, sample_rate)
        recombined = recombine_bands(low, mid, high)

        self.assertEqual(recombined.shape, audio.shape)
        self.assertLess(np.max(np.abs(audio - recombined)), 0.25)
