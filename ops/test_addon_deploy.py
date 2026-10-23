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


if __name__ == "__main__":
    unittest.main()
