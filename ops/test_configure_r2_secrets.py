import json
import os
from pathlib import Path
import stat
import tempfile
import unittest

from configure_r2_secrets import write_config


class ConfigureR2SecretsTests(unittest.TestCase):
    def test_writes_once_without_printing_secrets(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temporary:
            target = Path(temporary) / "r2.json"
            config = {
                "account_id": "a" * 32,
                "bucket": "test-bedrock",
                "access_key_id": "example-access",
                "secret_access_key": "example-secret",
                "restic_password": "example-password",
            }
            write_config(target, config)
            self.assertEqual(json.loads(target.read_text(encoding="utf-8")), config)
            if os.name != "nt":
                self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            with self.assertRaises(FileExistsError):
                write_config(target, config)
            self.assertEqual(json.loads(target.read_text(encoding="utf-8")), config)


if __name__ == "__main__":
    unittest.main()
