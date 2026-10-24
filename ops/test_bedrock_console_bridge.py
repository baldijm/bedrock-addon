import unittest
from unittest.mock import Mock

from bedrock_console_bridge import BedrockConsoleBridge, OutputBuffer, parse_address, validate_command


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


class PlayerListTests(unittest.TestCase):
    def test_returns_only_the_current_bedrock_list_response(self):
        output = OutputBuffer()
        bridge = BedrockConsoleBridge(__import__("pathlib").Path("."), output)
        bridge.submit = Mock(return_value=("command-id", 0))
        output.append("[2026-10-23 10:00:00: INFO] There are 2/10 players online: Alex, Steve")
        players = bridge.list_players()
        self.assertEqual(players["online"], 2)
        self.assertEqual(players["capacity"], 10)
        self.assertEqual(players["players"], ["Alex", "Steve"])

    def test_reads_names_from_the_following_bedrock_output_line(self):
        output = OutputBuffer()
        bridge = BedrockConsoleBridge(__import__("pathlib").Path("."), output)
        bridge.submit = Mock(return_value=("command-id", 0))
        output.append("[2026-10-23 10:00:00: INFO] There are 1/10 players online:")
        output.append("Garii")
        players = bridge.list_players()
        self.assertEqual(players["online"], 1)
        self.assertEqual(players["capacity"], 10)
        self.assertEqual(players["players"], ["Garii"])

    def test_fails_instead_of_returning_an_estimate_when_list_is_not_recognized(self):
        output = OutputBuffer()
        bridge = BedrockConsoleBridge(__import__("pathlib").Path("."), output)
        bridge.submit = Mock(return_value=("command-id", 0))
        output.append("some unrelated server line")
        with self.assertRaises(RuntimeError):
            bridge.list_players()


if __name__ == "__main__":
    unittest.main()
