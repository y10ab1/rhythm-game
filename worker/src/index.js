// Rhythm Game Leaderboard API — Cloudflare Worker + D1

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// Validate and sanitize player name
function sanitizeName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().slice(0, 20);
  if (trimmed.length < 1) return null;
  // Allow alphanumeric, CJK, spaces, underscores, hyphens
  if (!/^[\w\s\u4e00-\u9fff\u3400-\u4dbf\uF900-\uFAFF\u00C0-\u024F\-]+$/u.test(trimmed)) return null;
  return trimmed;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // POST /api/score — submit a score
      if (path === '/api/score' && request.method === 'POST') {
        const body = await request.json();

        const playerName = sanitizeName(body.player_name);
        if (!playerName) {
          return json({ error: 'Invalid player name (1-20 chars, alphanumeric/CJK)' }, 400);
        }

        const songName = typeof body.song_name === 'string' ? body.song_name.trim().slice(0, 50) : '';
        if (!songName) return json({ error: 'Missing song_name' }, 400);

        const difficulty = body.difficulty;
        if (!['easy', 'normal', 'hard'].includes(difficulty)) {
          return json({ error: 'Invalid difficulty' }, 400);
        }

        const score = parseInt(body.score);
        const accuracy = parseFloat(body.accuracy);
        const maxCombo = parseInt(body.max_combo);
        const perfect = parseInt(body.perfect) || 0;
        const great = parseInt(body.great) || 0;
        const good = parseInt(body.good) || 0;
        const miss = parseInt(body.miss) || 0;
        const rank = typeof body.rank === 'string' ? body.rank.slice(0, 2) : '?';

        if (isNaN(score) || score < 0 || score > 99999999) {
          return json({ error: 'Invalid score' }, 400);
        }
        if (isNaN(accuracy) || accuracy < 0 || accuracy > 100) {
          return json({ error: 'Invalid accuracy' }, 400);
        }
        if (isNaN(maxCombo) || maxCombo < 0) {
          return json({ error: 'Invalid max_combo' }, 400);
        }

        const result = await env.DB.prepare(
          `INSERT INTO scores (player_name, song_name, difficulty, score, accuracy, max_combo, perfect, great, good, miss, rank)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(playerName, songName, difficulty, score, accuracy, maxCombo, perfect, great, good, miss, rank).run();

        // Return the rank of this score for the song
        const rankResult = await env.DB.prepare(
          `SELECT COUNT(*) as position FROM scores
           WHERE song_name = ? AND difficulty = ? AND score > ?`
        ).bind(songName, difficulty, score).first();

        return json({
          success: true,
          id: result.meta.last_row_id,
          position: (rankResult?.position || 0) + 1,
        });
      }

      // GET /api/leaderboard?song=X&difficulty=Y&limit=Z
      if (path === '/api/leaderboard' && request.method === 'GET') {
        const song = url.searchParams.get('song') || '';
        const diff = url.searchParams.get('difficulty') || '';
        const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 50);

        let query, params;

        if (song && diff) {
          // Per-song leaderboard
          query = `SELECT player_name, score, accuracy, max_combo, rank, created_at
                   FROM scores WHERE song_name = ? AND difficulty = ?
                   ORDER BY score DESC LIMIT ?`;
          params = [song, diff, limit];
        } else if (song) {
          // Per-song, all difficulties
          query = `SELECT player_name, score, accuracy, max_combo, rank, difficulty, created_at
                   FROM scores WHERE song_name = ?
                   ORDER BY score DESC LIMIT ?`;
          params = [song, limit];
        } else {
          // Global leaderboard
          query = `SELECT player_name, song_name, score, accuracy, max_combo, rank, difficulty, created_at
                   FROM scores ORDER BY score DESC LIMIT ?`;
          params = [limit];
        }

        const results = await env.DB.prepare(query).bind(...params).all();
        return json({ leaderboard: results.results });
      }

      return json({ error: 'Not found' }, 404);

    } catch (err) {
      console.error(err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
};
