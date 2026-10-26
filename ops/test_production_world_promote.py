import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import production_world_promote as promote


class PromotedPropertiesTests(unittest.TestCase):
    def test_copies_dashboard_settings_but_preserves_production_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "production"
            staging = Path(directory) / "staging"
            root.mkdir()
            staging.mkdir()
            original = (
                "level-name=Old World\nserver-name=Production\n"
                "difficulty=normal\nview-distance=12\nserver-port=19132\n"
            )
            (root / "server.properties").write_text(original, encoding="utf-8")
            staging_values = {
                key: "hard" if key == "difficulty" else "24" if key == "view-distance" else ""
                for key in promote.PROMOTED_PROPERTIES
            }
            (staging / "server.properties").write_text(
                "\n".join(f"{key}={value}" for key, value in staging_values.items()) + "\n",
                encoding="utf-8",
            )
            with patch.object(promote, "STAGING_ROOT", staging):
                previous = promote.replace_level_name(root, "Forever World")

            result = (root / "server.properties").read_text(encoding="utf-8")
            self.assertEqual(previous, original)
            self.assertIn("level-name=Forever World\n", result)
            self.assertIn("difficulty=hard\n", result)
            self.assertIn("view-distance=24\n", result)
            self.assertIn("server-port=19132\n", result)

    def test_missing_staging_property_preserves_production_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "production"
            staging = Path(directory) / "staging"
            root.mkdir()
            staging.mkdir()
            original = "level-name=Old World\ndifficulty=normal\n"
            (root / "server.properties").write_text(original, encoding="utf-8")
            (staging / "server.properties").write_text("difficulty=hard\n", encoding="utf-8")
            with patch.object(promote, "STAGING_ROOT", staging):
                with self.assertRaisesRegex(RuntimeError, "Faltan propiedades"):
                    promote.replace_level_name(root, "Forever World")
            self.assertEqual((root / "server.properties").read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()
