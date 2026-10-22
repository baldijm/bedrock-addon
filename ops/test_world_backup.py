from pathlib import Path
import tempfile
import unittest

from world_backup import create_backup, restore_lab, verify_backup


class WorldBackupTests(unittest.TestCase):
    def test_archive_and_restore_in_lab_without_secret(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temporary:
            base = Path(temporary)
            root = base / "bedrock"
            db = root / "worlds" / "Bedrock HTTP Test" / "db"
            db.mkdir(parents=True)
            (db / "000001.ldb").write_bytes(b"world data")
            (root / "server.properties").write_text("level-name=Bedrock HTTP Test\n")
            (root / "allowlist.json").write_text("[]\n")
            (root / "permissions.json").write_text("[]\n")
            (root / ".api-token").write_text("never-back-up")

            archive = base / "backup.tar.gz"
            result = create_backup(root, archive, check_stopped=lambda: None)
            self.assertEqual(result["files"], 4)
            self.assertEqual(len(verify_backup(archive)["files"]), 4)

            restored = base / "restored"
            self.assertEqual(restore_lab(archive, restored), 4)
            self.assertEqual((restored / "worlds" / "Bedrock HTTP Test" / "db" / "000001.ldb").read_bytes(), b"world data")
            self.assertFalse((restored / ".api-token").exists())
            with self.assertRaises(FileExistsError):
                restore_lab(archive, restored)

    def test_rejects_symlink_and_active_server(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temporary:
            base = Path(temporary)
            root = base / "bedrock"
            (root / "worlds" / "world").mkdir(parents=True)
            (root / "worlds" / "world" / "level.dat").write_bytes(b"data")
            for name in ("server.properties", "allowlist.json", "permissions.json"):
                (root / name).write_text("test")

            def active():
                raise RuntimeError("Bedrock activo")

            with self.assertRaisesRegex(RuntimeError, "Bedrock activo"):
                create_backup(root, base / "active.tar.gz", check_stopped=active)

            try:
                (root / "worlds" / "world" / "outside").symlink_to(base)
            except (OSError, NotImplementedError):
                self.skipTest("El sistema no permite crear enlaces simbólicos")
            with self.assertRaisesRegex(RuntimeError, "no autorizada"):
                create_backup(root, base / "symlink.tar.gz", check_stopped=lambda: None)


if __name__ == "__main__":
    unittest.main()
