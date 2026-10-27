CREATE TABLE structure_upload_settings (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	max_upload_bytes INTEGER NOT NULL CHECK (max_upload_bytes BETWEEN 1048576 AND 104857600),
	updated_at TEXT NOT NULL
);

INSERT INTO structure_upload_settings (id, max_upload_bytes, updated_at)
VALUES (1, 20971520, CURRENT_TIMESTAMP);

CREATE TABLE structure_library (
	name TEXT PRIMARY KEY,
	version TEXT NOT NULL,
	object_key TEXT NOT NULL UNIQUE,
	size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
	etag TEXT NOT NULL,
	dimensions_x INTEGER NOT NULL,
	dimensions_y INTEGER NOT NULL,
	dimensions_z INTEGER NOT NULL,
	created_at TEXT NOT NULL,
	source TEXT NOT NULL
);
