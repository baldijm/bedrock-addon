CREATE TABLE structure_multipart_uploads (
	session_id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
	object_key TEXT NOT NULL UNIQUE,
	upload_id TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX structure_multipart_uploads_created_at
	ON structure_multipart_uploads (created_at);
