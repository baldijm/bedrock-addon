import unittest
from tempfile import TemporaryDirectory
from pathlib import Path
from unittest.mock import Mock, patch

import bedrock_console_bridge as bridge_module
from bedrock_console_bridge import BedrockConsoleBridge, OutputBuffer, parse_address, request_world_reset, validate_command, validate_structure_id


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
    def test_preloads_the_complete_footprint_then_removes_the_temporary_area(self):
        bridge = BedrockConsoleBridge(Path("."), OutputBuffer(), Path("unused.pid"))
        bridge._command_until = Mock(return_value=[])
        with patch.object(bridge_module.uuid, "uuid4", return_value=Mock(hex="0123456789abcdef")):
            result = bridge.place_structure(
                {
                    "structure": "spb:angel",
                    "x": 10,
                    "y": 80,
                    "z": 20,
                    "rotation": "0_degrees",
                    "mirror": "none",
                    "dimensions": {"x": 153, "y": 144, "z": 71},
                }
            )

        commands = [call.args[0] for call in bridge._command_until.call_args_list]
        self.assertEqual(commands[0], "tickingarea add 10 0 20 162 0 90 spb_place_0123456789ab true")
        self.assertEqual(commands[1], "structure load spb:angel 10 80 20 0_degrees none true true")
        self.assertEqual(commands[2], "tickingarea remove spb_place_0123456789ab")
        self.assertEqual(result["area"], {"from": {"x": 10, "z": 20}, "to": {"x": 162, "z": 90}})

    def test_rejects_unverified_or_unsafe_dimensions(self):
        bridge = BedrockConsoleBridge(Path("."), OutputBuffer(), Path("unused.pid"))
        with self.assertRaises(ValueError):
            bridge.place_structure({"structure": "spb:angel", "x": 0, "y": 80, "z": 0})


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


if __name__ == "__main__":
    unittest.main()
