CREATE TABLE commands (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment = 'staging'),
  command TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT,
  result TEXT
);

CREATE INDEX commands_recent ON commands (created_at DESC);
CREATE INDEX commands_queue ON commands (environment, status, created_at ASC);
