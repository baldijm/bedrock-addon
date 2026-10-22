from pathlib import Path
import unittest
from unittest.mock import patch

import production_backup


class ProductionBackupTests(unittest.TestCase):
    def test_restarts_after_archive_failure(self):
        with (
            patch.object(production_backup, "run_service") as service,
            patch.object(production_backup.world_backup, "ensure_stopped"),
            patch.object(
                production_backup.world_backup,
                "create_backup",
                side_effect=RuntimeError("falló el archivo"),
            ),
            patch.object(production_backup, "wait_for_running") as wait,
        ):
            with self.assertRaisesRegex(RuntimeError, "falló el archivo"):
                production_backup.create_during_maintenance(Path("backup.tar.gz"))
            self.assertEqual([call.args[0] for call in service.call_args_list], ["stop", "start"])
            wait.assert_called_once()

    def test_restarts_after_stop_failure(self):
        def fail_stop(action, _timeout):
            if action == "stop":
                raise RuntimeError("falló stop")

        with (
            patch.object(production_backup, "run_service", side_effect=fail_stop) as service,
            patch.object(production_backup, "wait_for_running") as wait,
        ):
            with self.assertRaisesRegex(RuntimeError, "falló stop"):
                production_backup.create_during_maintenance(Path("backup.tar.gz"))
            self.assertEqual([call.args[0] for call in service.call_args_list], ["stop", "start"])
            wait.assert_called_once()


if __name__ == "__main__":
    unittest.main()
