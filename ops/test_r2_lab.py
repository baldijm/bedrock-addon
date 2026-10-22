import unittest

from r2_lab import EXPECTED_ACCOUNT, EXPECTED_BUCKET, restic_environment


class R2LabTests(unittest.TestCase):
    def test_environment_points_only_to_expected_bucket(self):
        config = {
            "account_id": EXPECTED_ACCOUNT,
            "bucket": EXPECTED_BUCKET,
            "access_key_id": "access-example",
            "secret_access_key": "secret-example",
            "restic_password": "password-example",
        }
        environment = restic_environment(config)
        self.assertEqual(environment["AWS_ACCESS_KEY_ID"], "access-example")
        self.assertEqual(environment["RESTIC_PASSWORD"], "password-example")
        self.assertEqual(
            environment["RESTIC_REPOSITORY"],
            f"s3:https://{EXPECTED_ACCOUNT}.r2.cloudflarestorage.com/{EXPECTED_BUCKET}",
        )
        with self.assertRaises(RuntimeError):
            restic_environment({**config, "bucket": "another-bucket"})
        with self.assertRaises(RuntimeError):
            restic_environment({**config, "secret_access_key": ""})


if __name__ == "__main__":
    unittest.main()
