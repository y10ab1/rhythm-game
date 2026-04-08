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
