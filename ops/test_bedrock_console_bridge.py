import unittest

from bedrock_console_bridge import OutputBuffer, parse_address, validate_command


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


if __name__ == "__main__":
    unittest.main()
