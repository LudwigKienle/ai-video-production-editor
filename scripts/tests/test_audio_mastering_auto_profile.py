import unittest

from audio_mastering.auto_profile import choose_spotify_profile


class SpotifyAutoProfileTest(unittest.TestCase):
    def test_choose_spotify_profile_returns_balanced_for_general_music(self):
        features = {
            "integrated_lufs": -18.0,
            "crest_factor": 10.0,
            "stereo_width": 0.6,
            "voice_ratio": 0.3,
            "bass_side_ratio": 0.1,
        }

        profile = choose_spotify_profile(features, has_reference=False)

        self.assertEqual(profile["profile"], "spotify_balanced")
        self.assertEqual(profile["target_lufs"], -14.0)
        self.assertLessEqual(profile["stereo_width_percent"], 100)

    def test_choose_spotify_profile_returns_dialog_for_voice_forward_material(self):
        features = {
            "integrated_lufs": -20.0,
            "crest_factor": 8.0,
            "stereo_width": 0.15,
            "voice_ratio": 0.88,
            "bass_side_ratio": 0.02,
        }

        profile = choose_spotify_profile(features, has_reference=False)

        self.assertEqual(profile["profile"], "spotify_dialog")
        self.assertLess(profile["stereo_width_percent"], 90)

    def test_choose_spotify_profile_softens_eq_amount_without_reference(self):
        features = {
            "integrated_lufs": -17.0,
            "crest_factor": 7.0,
            "stereo_width": 0.7,
            "voice_ratio": 0.25,
            "bass_side_ratio": 0.18,
        }

        without_reference = choose_spotify_profile(features, has_reference=False)
        with_reference = choose_spotify_profile(features, has_reference=True)

        self.assertLess(without_reference["eq_match_amount"], with_reference["eq_match_amount"])


if __name__ == "__main__":
    unittest.main()
