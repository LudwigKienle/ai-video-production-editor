import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import soundfile as sf

from audio_mastering_worker import build_processing_plan, process_mastering_job


class ProcessingPlanTest(unittest.TestCase):
    def test_build_processing_plan_exposes_expected_stage_order(self):
        plan = build_processing_plan()
        self.assertEqual(plan[0], "decode")
        self.assertEqual(plan[-1], "export")

    def test_process_mastering_job_supports_spotify_auto_without_reference(self):
        sample_rate = 48000
        timeline = np.linspace(0, 4, sample_rate * 4, endpoint=False)
        audio = np.stack(
            [
                0.16 * np.sin(2 * np.pi * 220 * timeline),
                0.12 * np.sin(2 * np.pi * 330 * timeline),
            ],
            axis=1,
        ).astype(np.float32)

        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            target_path = temp_path / "target.wav"
            output_path = temp_path / "mastered_24bit.wav"
            sf.write(target_path, audio, sample_rate, subtype="PCM_24")

            result = process_mastering_job(
                {
                    "mode": "spotify_auto",
                    "targetPath": str(target_path),
                    "outputPath": str(output_path),
                    "compressionStrength": 5,
                    "stereoWidthPercent": 100,
                    "targetLufs": -14,
                    "advanced": {
                        "eqMatchAmount": 80,
                        "limiterCeilingDbtp": -1,
                        "lowMidCrossoverHz": 160,
                        "midHighCrossoverHz": 3200,
                    },
                }
            )

            self.assertEqual(result["autoProfile"], "spotify_balanced")
            self.assertTrue(output_path.exists())
            self.assertIn("spotifyReady", result)
