-- SQLite cannot alter a CHECK constraint in place. Rebuild this small settings
-- table while preserving the single existing row and its timestamp.
CREATE TABLE structure_upload_settings_next (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	max_upload_bytes INTEGER NOT NULL CHECK (max_upload_bytes BETWEEN 1048576 AND 157286400),
	updated_at TEXT NOT NULL
);

INSERT INTO structure_upload_settings_next (id, max_upload_bytes, updated_at)
SELECT id, max_upload_bytes, updated_at
FROM structure_upload_settings;

DROP TABLE structure_upload_settings;
ALTER TABLE structure_upload_settings_next RENAME TO structure_upload_settings;
