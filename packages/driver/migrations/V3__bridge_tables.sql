CREATE TABLE IF NOT EXISTS bridge_seen_messages (
    message_id TEXT PRIMARY KEY,
    seen_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS bridge_chat_histories (
    chat_id TEXT PRIMARY KEY,
    messages TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_seen_at ON bridge_seen_messages(seen_at);
CREATE INDEX IF NOT EXISTS idx_hist_updated ON bridge_chat_histories(updated_at);
