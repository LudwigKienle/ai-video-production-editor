import unittest

from audio_mastering.validation import should_run_correction_pass, validate_master


class SpotifyMasterValidationTest(unittest.TestCase):
    def test_validate_master_flags_true_peak_violation(self):
        report = validate_master(
            {
                "after_true_peak_dbtp": -0.2,
                "after_lufs": -14.0,
                "stereo_width_percent": 88.0,
                "bass_side_ratio": 0.04,
            },
            target_lufs=-14.0,
            ceiling_dbtp=-1.0,
        )

        self.assertFalse(report["spotify_ready"])
        self.assertIn("true_peak", report["issues"])

    def test_should_run_correction_pass_returns_true_for_non_spotify_safe_master(self):
        report = validate_master(
            {
                "after_true_peak_dbtp": -1.1,
                "after_lufs": -11.9,
                "stereo_width_percent": 92.0,
                "bass_side_ratio": 0.12,
            },
            target_lufs=-14.0,
            ceiling_dbtp=-1.0,
        )

        self.assertTrue(should_run_correction_pass(report))


if __name__ == "__main__":
    unittest.main()
