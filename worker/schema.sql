-- Leaderboard table for Rhythm Game
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name TEXT NOT NULL,
  song_name TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  score INTEGER NOT NULL,
  accuracy REAL NOT NULL,
  max_combo INTEGER NOT NULL,
  perfect INTEGER NOT NULL DEFAULT 0,
  great INTEGER NOT NULL DEFAULT 0,
  good INTEGER NOT NULL DEFAULT 0,
  miss INTEGER NOT NULL DEFAULT 0,
  rank TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scores_song ON scores(song_name, difficulty, score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_global ON scores(score DESC);

-- Play log: one row per play (cleared, failed, quit, retried or closed mid-song), sent by js/main.js logPlay().
-- Anonymous: client_id is a random id kept in the browser; no IP is stored (country comes from Cloudflare).
-- notes = JSON [[time ms, lane, offset ms (+ late, null = miss), flags]] for every note the player reached;
-- flags: 1 hold, 2 slide, 4 sweep, 8 hold let go early.
CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  play_id TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  player_name TEXT,
  song_id TEXT NOT NULL,
  song_title TEXT,
  builtin INTEGER NOT NULL DEFAULT 0,
  kind TEXT,
  difficulty TEXT NOT NULL,
  level INTEGER,
  bpm INTEGER,
  outcome TEXT NOT NULL,          -- clear | failed | quit | retry | closed
  score INTEGER, accuracy REAL, max_combo INTEGER,
  perfect INTEGER, great INTEGER, good INTEGER, miss INTEGER,
  fast INTEGER, slow INTEGER, median_offset INTEGER, rank TEXT,
  notes_total INTEGER, song_ms INTEGER, end_ms INTEGER, wall_ms INTEGER, pauses INTEGER,
  input TEXT,                     -- key | touch | mixed | none
  country TEXT,
  settings TEXT,                  -- JSON
  device TEXT,                    -- JSON
  notes TEXT,                     -- JSON, see above
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plays_song ON plays(song_id, difficulty, created_at);
CREATE INDEX IF NOT EXISTS idx_plays_client ON plays(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_plays_created ON plays(created_at);
