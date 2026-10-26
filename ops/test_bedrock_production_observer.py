import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import bedrock_production_observer as observer


class WorldStateTests(unittest.TestCase):
    def test_reports_saved_difficulty_independently_of_server_properties(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            world = root / "worlds" / "Forever World"
            world.mkdir(parents=True)
            (root / "server.properties").write_text(
                "level-name=Forever World\ndifficulty=normal\n", encoding="utf-8"
            )
            (world / "level.dat").write_bytes(
                b"\x03\x0a\x00Difficulty" + struct.pack("<i", 3)
                + b"\x03\x08\x00GameType" + struct.pack("<i", 0)
            )
            with patch.object(observer, "ROOT", root), patch.object(observer, "WORLDS_ROOT", root / "worlds"):
                self.assertEqual(
                    observer.production_world_state(),
                    {"world": "Forever World", "savedDifficulty": "hard", "savedGamemode": "survival"},
                )


if __name__ == "__main__":
    unittest.main()
