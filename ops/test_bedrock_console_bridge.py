import unittest
from tempfile import TemporaryDirectory
from pathlib import Path
from unittest.mock import Mock, patch

import bedrock_console_bridge as bridge_module
from bedrock_console_bridge import BedrockConsoleBridge, OutputBuffer, parse_address, read_update_status, read_world_seed, request_world_reset, validate_command, validate_structure_id, validate_world_reset_request


class ValidateCommandTests(unittest.TestCase):
    def test_trims_the_minecraft_prefix(self):
        self.assertEqual(validate_command(" /say hola "), "say hola")

    def test_rejects_multiple_lines(self):
        with self.assertRaises(ValueError):
            validate_command("say hola\nstop")

    def test_rejects_empty_or_non_text(self):
        for value in ("", "   ", None):
            with self.assertRaises(ValueError):
                validate_command(value)


class StructureIdentifierTests(unittest.TestCase):
    def test_accepts_a_valid_bedrock_identifier(self):
        self.assertEqual(validate_structure_id("mystructure:casa_principal"), ("mystructure:casa_principal", "mystructure", "casa_principal"))

    def test_rejects_paths_and_malformed_identifiers(self):
        for value in ("mystructure:../secreto", "mystructure:/secreto", "my structure:casa", None):
            with self.assertRaises(ValueError):
                validate_structure_id(value)


class StructurePlacementTests(unittest.TestCase):
    def test_delegates_loading_and_placement_to_the_addon_with_a_correlated_request(self):
        bridge = BedrockConsoleBridge(Path("."), OutputBuffer(), Path("unused.pid"))
        bridge._command_until_result = Mock(return_value=[])
        with patch.object(bridge_module.uuid, "uuid4", return_value=Mock(hex="0123456789abcdef")):
            result = bridge.place_structure(
                {
                    "structure": "spb:angel",
                    "x": 10,
                    "y": 80,
                    "z": 20,
                    "rotation": "0_degrees",
                    "mirror": "none",
                    "mode": "instant",
                    "dimensions": {"x": 153, "y": 144, "z": 71},
                }
            )

        command = bridge._command_until_result.call_args.args[0]
        prefix, payload = command.split(" ", 2)[1:]
        self.assertEqual(prefix, "spb:structure_place")
        self.assertEqual(
            __import__("json").loads(payload),
            {
                "request": "0123456789ab",
                "structure": "spb:angel",
                "x": 10,
                "y": 80,
                "z": 20,
                "minX": 10,
                "maxX": 162,
                "minZ": 20,
                "maxZ": 90,
                "width": 153,
                "height": 144,
                "depth": 71,
                "rotation": "0_degrees",
                "mirror": "none",
                "mode": "instant",
                "includeBlocks": True,
                "includeAir": True,
                "protectBlocks": False,
                "protectPlace": False,
                "protectEnvironment": False,
            },
        )
        self.assertEqual(result["area"], {"from": {"x": 10, "z": 20}, "to": {"x": 162, "z": 90}})

    def test_surfaces_the_correlated_addon_error(self):
        output = OutputBuffer()
        bridge = BedrockConsoleBridge(Path("."), output, Path("unused.pid"))

        def submit(_command):
            cursor = output.append("SPB_STRUCTURE_PLACE abcdef123456 ERROR no hay capacidad") - 1
            return "command", cursor

        bridge.submit = submit
        with self.assertRaisesRegex(RuntimeError, "no hay capacidad"):
            bridge._command_until_result(
                "scriptevent spb:structure_place {}",
                __import__("re").compile(r"SPB_STRUCTURE_PLACE\s+abcdef123456\s+OK\b"),
                __import__("re").compile(
                    r"SPB_STRUCTURE_PLACE\s+abcdef123456\s+ERROR(?:\s+(?P<detail>.*))?$"
                ),
                0.1,
            )

    def test_rejects_unverified_or_unsafe_dimensions(self):
        bridge = BedrockConsoleBridge(Path("."), OutputBuffer(), Path("unused.pid"))
        with self.assertRaises(ValueError):
            bridge.place_structure({"structure": "spb:angel", "x": 0, "y": 80, "z": 0})


class StructureEraseTests(unittest.TestCase):
    def test_delegates_a_bounded_erase_to_the_addon(self):
        bridge = BedrockConsoleBridge(Path("."), OutputBuffer(), Path("unused.pid"))
        bridge._command_until_result = Mock(return_value=[])
        with patch.object(bridge_module.uuid, "uuid4", return_value=Mock(hex="0123456789abcdef")):
            result = bridge.erase_area(
                {"x": 10, "y": 60, "z": 20, "width": 12, "height": 8, "depth": 14}
            )

        command = bridge._command_until_result.call_args.args[0]
        prefix, payload = command.split(" ", 2)[1:]
        self.assertEqual(prefix, "spb:structure_erase")
        self.assertEqual(
            __import__("json").loads(payload),
            {
                "request": "0123456789ab",
                "x": 10,
                "y": 60,
                "z": 20,
                "minX": 10,
                "maxX": 21,
                "minZ": 20,
                "maxZ": 33,
                "width": 12,
                "height": 8,
                "depth": 14,
            },
        )
        self.assertEqual(
            result["area"],
            {"from": {"x": 10, "y": 60, "z": 20}, "to": {"x": 21, "y": 67, "z": 33}},
        )

    def test_rejects_an_oversized_erase(self):
        bridge = BedrockConsoleBridge(Path("."), OutputBuffer(), Path("unused.pid"))
        with self.assertRaises(ValueError):
            bridge.erase_area(
                {"x": 0, "y": 0, "z": 0, "width": 512, "height": 512, "depth": 512}
            )


class StructureImportTests(unittest.TestCase):
    def test_writes_to_the_active_behavior_pack_without_reading_past_content_length(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            world = root / "worlds" / "Forever World"
            (world / "db").mkdir(parents=True)
            (root / "server.properties").write_text("level-name=Forever World\n", encoding="utf-8")
            bridge = BedrockConsoleBridge(root, OutputBuffer(), root / "unused.pid")
            stream = Mock()
            stream.read.side_effect = [b"abc", AssertionError("Read past Content-Length")]
            result = bridge.import_structure("spb:plaza", stream, 3)
            stream.read.assert_called_once_with(3)
            target = root / "behavior_packs" / "SPB_BP" / "structures" / "spb" / "plaza.mcstructure"
            self.assertEqual(target.read_bytes(), b"abc")
            self.assertEqual(result["structure"], "spb:plaza")

    def test_rejects_incomplete_upload_without_replacing_an_existing_file(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            world = root / "worlds" / "Forever World"
            target = root / "behavior_packs" / "SPB_BP" / "structures" / "spb" / "plaza.mcstructure"
            target.parent.mkdir(parents=True)
            (world / "db").mkdir(parents=True)
            target.write_bytes(b"previous")
            (root / "server.properties").write_text("level-name=Forever World\n", encoding="utf-8")
            bridge = BedrockConsoleBridge(root, OutputBuffer(), root / "unused.pid")
            with self.assertRaises(ValueError):
                bridge.import_structure("spb:plaza", __import__("io").BytesIO(b"short"), 6)
            self.assertEqual(target.read_bytes(), b"previous")

    def test_confirms_only_the_expected_materialized_file(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            world = root / "worlds" / "Forever World"
            target = root / "behavior_packs" / "SPB_BP" / "structures" / "spb" / "plaza.mcstructure"
            target.parent.mkdir(parents=True)
            (world / "db").mkdir(parents=True)
            target.write_bytes(b"abc")
            (root / "server.properties").write_text("level-name=Forever World\n", encoding="utf-8")
            bridge = BedrockConsoleBridge(root, OutputBuffer(), root / "unused.pid")
            self.assertTrue(bridge.materialized_structure("spb:plaza", 3)["ok"])
            self.assertFalse(bridge.materialized_structure("spb:plaza", 4)["ok"])


class OutputBufferTests(unittest.TestCase):
    def test_returns_only_newer_output(self):
        output = OutputBuffer(limit=3)
        output.append("uno")
        second = output.append("dos")
        output.append("tres")
        lines, cursor = output.after(second)
        self.assertEqual([line["text"] for line in lines], ["tres"])
        self.assertEqual(cursor, 3)

    def test_discards_old_lines_at_the_limit(self):
        output = OutputBuffer(limit=2)
        output.append("uno")
        output.append("dos")
        output.append("tres")
        lines, _ = output.after(0)
        self.assertEqual([line["text"] for line in lines], ["dos", "tres"])


class AddressTests(unittest.TestCase):
    def test_accepts_only_loopback(self):
        self.assertEqual(parse_address("127.0.0.1:3002"), ("127.0.0.1", 3002))
        with self.assertRaises(Exception):
            parse_address("0.0.0.0:3002")


class WorldResetPrivilegeTests(unittest.TestCase):
    def test_reads_and_preserves_the_active_world_seed(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            world = root / "worlds" / "Forever World"
            world.mkdir(parents=True)
            (root / "server.properties").write_text("level-name=Forever World\n", encoding="utf-8")
            seed = -2841496551225756511
            (world / "level.dat").write_bytes(
                b"\x08\x00\x00\x00" + b"\x00" * 12 + b"\x04\x0a\x00RandomSeed" + __import__("struct").pack("<q", seed)
            )

            self.assertEqual(read_world_seed(root), str(seed))
            self.assertEqual(
                validate_world_reset_request(
                    root,
                    {"mode": "preserve", "seed": "", "confirmation": "Forever World"},
                ),
                {"mode": "preserve", "seed": str(seed), "world": "Forever World"},
            )

    def test_sudoers_allows_the_command_used_by_the_bridge(self):
        rule = (Path(__file__).parent / "sudoers" / "spb-staging-world-reset").read_text(encoding="utf-8")
        with TemporaryDirectory() as directory:
            with (
                patch.object(bridge_module, "WORLD_RESET_REQUESTS", Path(directory)),
                patch.object(
                    bridge_module,
                    "validate_world_reset_request",
                    return_value={"mode": "random", "seed": "", "world": "Forever World"},
                ),
                patch.object(bridge_module.subprocess, "run") as run,
            ):
                operation = request_world_reset(Path("/opt/bedrock-staging"), {})

        command = run.call_args.args[0]
        authorized_command = " ".join(command[1:]).replace(operation, "*")
        self.assertIn(authorized_command, rule)

    def test_installer_deploys_the_world_reset_worker(self):
        installer = (Path(__file__).parent / "install_console_bridge.sh").read_text(encoding="utf-8")
        for required in (
            "staging_world_reset.py",
            "spb-staging-world-reset@.service",
            "/etc/sudoers.d/spb-staging-world-reset",
            "/var/lib/spb/staging-world-reset/requests",
            "/var/lib/spb/structure-exports",
        ):
            self.assertIn(required, installer)


class PlayerListTests(unittest.TestCase):
    def test_returns_only_the_current_bedrock_list_response(self):
        output = OutputBuffer()
        bridge = BedrockConsoleBridge(Path("."), output, Path("unused.pid"))
        bridge.submit = Mock(return_value=("command-id", 0))
        output.append("[2026-10-23 10:00:00: INFO] There are 2/10 players online: Alex, Steve")
        players = bridge.list_players()
        self.assertEqual(players["online"], 2)
        self.assertEqual(players["capacity"], 10)
        self.assertEqual(players["players"], ["Alex", "Steve"])

    def test_reads_names_from_the_following_bedrock_output_line(self):
        output = OutputBuffer()
        bridge = BedrockConsoleBridge(Path("."), output, Path("unused.pid"))
        bridge.submit = Mock(return_value=("command-id", 0))
        output.append("[2026-10-23 10:00:00: INFO] There are 1/10 players online:")
        output.append("Garii")
        players = bridge.list_players()
        self.assertEqual(players["online"], 1)
        self.assertEqual(players["capacity"], 10)
        self.assertEqual(players["players"], ["Garii"])

    def test_fails_instead_of_returning_an_estimate_when_list_is_not_recognized(self):
        output = OutputBuffer()
        bridge = BedrockConsoleBridge(Path("."), output, Path("unused.pid"))
        bridge.submit = Mock(return_value=("command-id", 0))
        output.append("some unrelated server line")
        with self.assertRaises(RuntimeError):
            bridge.list_players()


class UpdateStatusTests(unittest.TestCase):
    def test_reads_server_version_and_ignores_pack_version(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            output = OutputBuffer()
            output.append("[2026-10-28 18:37:33:020 INFO] Version: 1.26.52.3")
            output.append("[2026-10-28 18:37:33:439 INFO] Pack Stack - BP 1.0.50 (version: 1.0.56)")
            with patch.object(bridge_module, "UPDATE_STATUS", root / "status"):
                self.assertEqual(read_update_status(root, output)["installedVersion"], "1.26.52.3")


if __name__ == "__main__":
    unittest.main()
