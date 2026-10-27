import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

import addon_deploy


class AddonDeployTests(unittest.TestCase):
    def test_requires_full_commit(self):
        commit = "a" * 40
        self.assertEqual(addon_deploy.require_commit(commit.upper()), commit)
        with self.assertRaisesRegex(RuntimeError, "40 caracteres"):
            addon_deploy.require_commit("abc123")

    def test_production_requires_matching_staging_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            with patch.object(addon_deploy, "STATE", state):
                (state / "receipts").mkdir()
                (state / "receipts/staging.json").write_text('{"commit": "a"}')
                with self.assertRaisesRegex(RuntimeError, "último desplegado"):
                    addon_deploy.production_receipt_matches("b")

    def test_preserves_runtime_structures_and_restores_writable_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            previous = root / "previous"
            current = root / "current"
            (previous / "spb").mkdir(parents=True)
            (current / "spb").mkdir(parents=True)
            (previous / "spb/finn.mcstructure").write_bytes(b"r2")
            (current / "spb/angel.mcstructure").write_bytes(b"git")

            with patch.object(addon_deploy.shutil, "chown") as chown:
                addon_deploy.preserve_runtime_structures(previous, current)

            self.assertEqual((current / "spb/finn.mcstructure").read_bytes(), b"r2")
            self.assertEqual((current / "spb/angel.mcstructure").read_bytes(), b"git")
            self.assertEqual((current / "spb").stat().st_mode & 0o777, 0o750)
            self.assertTrue(chown.called)


if __name__ == "__main__":
    unittest.main()
