// Express-based server for Joke Generator
const express = require('express');
const path = require('path');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const Database = require('better-sqlite3');

let db;
function initDb() {
  db = new Database('jokes.db');
  db.exec(`
CREATE TABLE IF NOT EXISTS jokes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT UNIQUE,
  category TEXT,
  rating INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  dislikes INTEGER DEFAULT 0,
  length INTEGER DEFAULT 0,
  has_emoji INTEGER DEFAULT 0,
  has_wordplay INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`);

  db.exec(`
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  joke_id INTEGER,
  content TEXT,
  rating INTEGER,
  length INTEGER,
  has_emoji INTEGER,
  has_wordplay INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`);
  
  db.exec(`
CREATE TABLE IF NOT EXISTS curated_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT UNIQUE,
  approved INTEGER DEFAULT 0,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`);
  
  const { runMigrations } = require('./lib/migrations');
  runMigrations(db);
}
initDb();

const app = express();
const PORT = process.env.PORT || 3000;

const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://ollama:11434').replace(/\/$/, '');
const OLLAMA_URL = `${OLLAMA_HOST}/api/generate`;
// Prefer environment variable (set in docker-compose). Default to llama3:2b
let currentModel = process.env.OLLAMA_MODEL || 'gemma2:2b';

app.use(cors());
app.use(express.json());

// Serve static files from Vite build 'dist' when available (production),
// otherwise serve the repository root (development / legacy static files).
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  // Fallback to index.html for client-side routing, but let /api/* and /admin/* API routes pass through
  app.get('*', (req, res, next) => {
    // If it's an API call or a specific admin API route, let it pass to Express handlers
    if (req.path.startsWith('/api/') || req.path.startsWith('/admin/')) return next();
    // Otherwise, it's a client-side route, serve index.html
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  app.use(express.static(__dirname));
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });
}

function analyzeJoke(joke) {
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]/u;
  const wordplayPatterns = [
    /homophone/i, /double sens/i, /paronomase/i, /calembour/i,
    /play on words/i, /mots? (qui |qui ) se? (ressemble|confond)/i
  ];
  
  return {
    length: joke.length,
    has_emoji: emojiRegex.test(joke) ? 1 : 0,
    has_wordplay: wordplayPatterns.some(p => p.test(joke)) ? 1 : 0
  };
}

// Validation function to ensure joke quality and non-truncation
function validateJoke(joke) {
  const trimmed = joke.trim();
  if (trimmed.length < 15 || trimmed.length > 300) return false;
  // Truncation check: must end with terminal punctuation
  const validEndings = ['.', '!', '?', '"', '...'];
  return validEndings.some(p => trimmed.endsWith(p));
}

function getPromptForModel(model, bestJokes, recentJokes, worstJokes, stats) {
  const best = bestJokes.map(j => `- ${j.content}`).join('\n');
  const recent = recentJokes.map(j => `- ${j.content}`).join('\n');
  const worst = worstJokes.map(j => `- ${j.content}`).join('\n');

  let styleProfile = "Humour varié, court et incisif.";
  if (stats && stats.totalLikes > 5) {
    styleProfile = `Basé sur les succès : ${stats.wordplayRate > 0.5 ? 'privilégie les jeux de mots, ' : 'privilégie l\'observation directe, '}${stats.emojiRate > 0.3 ? 'utilise souvent des emojis, ' : 'sobre sans emojis, '}${stats.avgLength < 100 ? 'très concis.' : 'plus détaillé.'}`;
  }

  return `<|system|>
Tu es un humoriste expert en humour francophone. Ton objectif est de générer UNE SEULE blague unique, drôle et originale.

1. PROFIL DE STYLE (Appris par le feedback) :
${styleProfile}

2. INSPIRATION (Très apprécié) :
${best}

3. ÉVITEMENT (Ne PAS répéter) :
${recent}
${worst}

4. CONTRAINTES STRICTES :
- 1 à 2 phrases max.
- Texte brut seulement.
- Aucune explication.
- PAS de politique, religion, violence.
- Sujet obligatoirement différent des exemples de rejet.
<|user|>
Génère une nouvelle blague unique en respectant le style appris et en changeant de sujet :
<|assistant|>`;
}

async function callOllama(prompt) {
  const payload = {
    model: currentModel,
    prompt,
    stream: false,
    options: { temperature: 0.85, num_predict: 120, top_p: 0.92 }
  };

  const controller = new AbortController();
  // Increase timeout to 60s to account for model cold-starts
  const id = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(id);
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);

    const json = await res.json().catch(() => null);
    if (!json) return '';
    return typeof json === 'string' ? json : (json.response || '');
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// Query Ollama for installed models (returns array of model names)
async function getAvailableModels() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { method: 'GET' });
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    if (!json) return [];
    // Ollama API /api/tags returns { models: [{ name, ... }] }
    if (json.models && Array.isArray(json.models)) return json.models.map(m => m.name || m);
    return [];
  } catch (e) {
    return [];
  }
}

// Try generating using configured model; if it fails, try installed models as fallback.
async function generateWithFallback(prompt) {
  // first try configured model
  try {
    return await callOllama(prompt);
  } catch (e) {
    console.warn('Primary model failed:', e.message);
  }

  // try models reported by Ollama
  const available = await getAvailableModels();
  for (const m of available) {
    if (!m || m === currentModel) continue;
    try {
      // temporarily override model for this call
      const payload = { model: m, prompt, stream: false, options: { temperature: 0.85, num_predict: 120, top_p: 0.92 } };
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 60000);
      const res = await fetch(OLLAMA_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
      clearTimeout(id);
      if (!res.ok) continue;
      const json = await res.json().catch(() => null);
      if (!json) continue;
      return typeof json === 'string' ? json : (json.response || '');
    } catch (err) {
      console.warn('Fallback model failed', m, err.message || err);
      continue;
    }
  }
  throw new Error('All models failed');
}

app.post('/api/generate', async (req, res) => {
  // Get enhanced stats
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as totalLikes,
      AVG(length) as avgLength,
      AVG(has_emoji) as emojiRate,
      AVG(has_wordplay) as wordplayRate
    FROM jokes WHERE rating >= 1
  `).get();

  // Best jokes with features
  const bestJokes = db.prepare(`
    SELECT id, content, has_emoji, has_wordplay 
    FROM jokes WHERE rating >= 1 
    ORDER BY rating DESC LIMIT 8
  `).all();

  // Recent jokes (avoid repeating topics)
  const recentJokes = db.prepare(`
    SELECT content FROM jokes ORDER BY created_at DESC LIMIT 6
  `).all();

  // Get jokes to avoid (strongly disliked)
  const worstJokes = db.prepare(`
    SELECT content FROM jokes WHERE rating < -1 
    ORDER BY rating ASC LIMIT 4
  `).all();

  let joke = '';
  let attempts = 0;
  const maxAttempts = 12;

  while (attempts < maxAttempts) {
    const prompt = getPromptForModel(currentModel, bestJokes, recentJokes, worstJokes, stats);
    try {
      const out = await generateWithFallback(prompt);
      joke = (typeof out === 'string') ? out.trim() : '';
      
      // Post-processing and validation
      joke = joke.replace(/^['"-]+/, '').replace(/['"-]+$/, '').trim();
      
      if (validateJoke(joke)) {
        const exists = db.prepare('SELECT 1 FROM jokes WHERE content = ?').get(joke);
        if (!exists) {
          const features = analyzeJoke(joke);
          const info = db.prepare(`
            INSERT INTO jokes (content, category, length, has_emoji, has_wordplay) 
            VALUES (?, ?, ?, ?, ?)
          `).run(joke, 'joke', features.length, features.has_emoji, features.has_wordplay);
          db.prepare(`INSERT INTO feedback (joke_id, content, rating, length, has_emoji, has_wordplay) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(info.lastInsertRowid, joke, 0, features.length, features.has_emoji, features.has_wordplay);
          res.json({ joke });
          return;
        }
      }
      attempts++;
    } catch (e) {
      console.error('Gen error:', e.message);
      res.status(500).json({ error: 'Erreur generation' });
      return;
    }
  }
  res.status(500).json({ error: 'Impossible de generer' });
});

app.post('/api/rate', (req, res) => {
  const { joke, rating, hasEmoji, hasWordplay } = req.body;
  if (!joke || typeof rating === 'undefined') return res.status(400).send();

  // Auto-detect features if not provided
  const features = hasEmoji !== undefined ? { has_emoji: hasEmoji, has_wordplay: hasWordplay, length: (joke || '').length } : analyzeJoke(joke);

  // Find existing joke id
  const row = db.prepare('SELECT id FROM jokes WHERE content = ?').get(joke);
  if (row) {
    // update rating and likes/dislikes counters
    db.prepare('UPDATE jokes SET rating = rating + ?, likes = likes + ?, dislikes = dislikes + ? WHERE id = ?')
      .run(rating, rating > 0 ? 1 : 0, rating < 0 ? 1 : 0, row.id);
    // insert feedback record
    db.prepare('INSERT INTO feedback (joke_id, content, rating, length, has_emoji, has_wordplay) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, joke, rating, features.length, features.has_emoji, features.has_wordplay);
  } else {
    // create new joke entry
    const info = db.prepare('INSERT INTO jokes (content, rating, likes, dislikes, length, has_emoji, has_wordplay) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(joke, rating, rating > 0 ? 1 : 0, rating < 0 ? 1 : 0, features.length, features.has_emoji, features.has_wordplay);
    db.prepare('INSERT INTO feedback (joke_id, content, rating, length, has_emoji, has_wordplay) VALUES (?, ?, ?, ?, ?, ?)')
      .run(info.lastInsertRowid, joke, rating, features.length, features.has_emoji, features.has_wordplay);
  }

  // Return updated metrics for the joke
  const metrics = db.prepare('SELECT likes, dislikes, rating FROM jokes WHERE content = ?').get(joke) || { likes: 0, dislikes: 0, rating: 0 };
  res.json({ ok: true, metrics });
});

// Get metrics for a joke (likes/dislikes/counts)
app.get('/api/joke/metrics', (req, res) => {
  const content = req.query.content || '';
  if (!content) return res.json({ likes: 0, dislikes: 0, rating: 0 });
  const row = db.prepare('SELECT likes, dislikes, rating FROM jokes WHERE content = ?').get(content);
  if (!row) return res.json({ likes: 0, dislikes: 0, rating: 0 });
  res.json(row);
});

// Note: root route is handled above depending on whether dist exists.

// Admin: export collected feedback and top jokes as JSON (simple dump)
app.get('/admin/export-feedback', (req, res) => {
  try {
    const feedback = db.prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT 1000').all();
    const top = db.prepare('SELECT id, content, likes, dislikes, rating, created_at FROM jokes ORDER BY rating DESC LIMIT 200').all();
    res.json({ feedback, top });
  } catch (e) {
    res.status(500).json({ error: 'export failed' });
  }
});

// Admin: curated examples management (open access by design)
app.get('/admin/curated', (req, res) => {
  const rows = db.prepare('SELECT id, content, approved, notes, created_at FROM curated_examples ORDER BY created_at DESC').all();
  res.json(rows);
});

app.post('/admin/curated', (req, res) => {
  const { content, approved = 0, notes = '' } = req.body || {};
  if (!content) return res.status(400).json({ error: 'content required' });
  try {
    db.prepare('INSERT OR IGNORE INTO curated_examples (content, approved, notes) VALUES (?, ?, ?)').run(content, approved ? 1 : 0, notes);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'insert failed' });
  }
});

app.delete('/admin/curated/:id', (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'id required' });
  db.prepare('DELETE FROM curated_examples WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- Admin: Model management ---
app.get('/admin/models', async (req, res) => {
  const models = await getAvailableModels();
  res.json({ models, current: currentModel });
});

app.post('/admin/set-model', (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).send();
  currentModel = model;
  console.log(`Model switched to: ${currentModel}`);
  res.json({ ok: true, current: currentModel });
});

app.post('/admin/reset-db', (req, res) => {
  try {
    db.close();
    if (fs.existsSync('jokes.db')) fs.unlinkSync('jokes.db');
    initDb();
    res.json({ ok: true, message: 'Database reset successfully' });
  } catch (e) {
    res.status(500).json({ error: 'Reset failed: ' + e.message });
  }
});

if (require.main === module) {
    const certPath = '/tmp/cert.pem';
    const keyPath = '/tmp/key.pem';

    try {
      const options = { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
      https.createServer(options, app).listen(PORT, '0.0.0.0', () => {
        console.log(`HTTPS server listening on 0.0.0.0:${PORT}`);
      });
    } catch (e) {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`HTTP server listening on 0.0.0.0:${PORT}`);
      });
    }
}

module.exports = { validateJoke, getPromptForModel };
// (Actually just add this to the end of server.js)
