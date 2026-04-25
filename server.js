// Express-based server for Joke Generator
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const Database = require('better-sqlite3');
const request = require('request'); // Using request library for Ollama API calls

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

// Prefer environment variable (set in docker-compose). Default to qwen:1.8b
let currentModel = process.env.OLLAMA_MODEL || 'qwen:1.8b';

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

// Validation function to ensure joke quality, twist, and non-truncation
function validateJoke(joke) {
  const trimmed = joke.trim();
  // Length check
  if (trimmed.length < 20 || trimmed.length > 180) return false;
  // Must end with terminal punctuation
  const validEndings = ['.', '!', '?', '"', '...'];
  if (!validEndings.some(p => trimmed.endsWith(p))) return false;
  // Twist detection heuristics
  return hasTwist(trimmed);
}

// Twist detection: contradiction logique, chute inattendue, changement de sens
function hasTwist(joke) {
  const lower = joke.toLowerCase();
  // Must have a question mark (setup + punchline structure)
  if (!lower.includes('?')) return false;
  // Split into setup and punchline
  const parts = joke.split('?');
  if (parts.length < 2) return false;
  const setup = parts[0].toLowerCase();
  const punchline = parts.slice(1).join('?').trim().toLowerCase();
  if (punchline.length < 10) return false;
  // Heuristics for twist:
  // 1. Contradiction keywords
  const contradictionWords = ['mais', 'pourtant', 'cependant', 'alors que', 'sauf que'];
  if (contradictionWords.some(w => punchline.includes(w))) return true;
  // 2. Unexpected words (absurde/cynique)
  const twistWords = ['parce que', 'simplement parce', 'en fait', 'finalement'];
  if (twistWords.some(w => punchline.includes(w))) return true;
  // 3. Punchline differs semantically from setup (simple: check keyword overlap is low)
  const setupWords = new Set(setup.split(/\W+/).filter(w => w.length > 3));
  const punchWords = new Set(punchline.split(/\W+/).filter(w => w.length > 3));
  let common = 0;
  for (const w of punchWords) { if (setupWords.has(w)) common++; }
  // If punchline shares too many words with setup, it's probably not a twist
  if (punchWords.size > 0 && common / punchWords.size > 0.6) return false;
  // 4. Check for absurde/cynique patterns
  const cynicalPatterns = [
    /parce qu(e|\')/,
    /personne ne/,
    /tout simplement/,
    /la vérité/,
    /plus simple que/,
    /fuir|fuyez/
  ];
  if (cynicalPatterns.some(p => punchline.match(p))) return true;
  // If we reach here, check if there's a clear answer after the question
  return punchline.length > 15;
}

function getPromptForModel(model, bestJokes, recentJokes, worstJokes) {
  const best = bestJokes.map(j => `- ${j.content}`).join('\n');
  const recent = recentJokes.map(j => `- ${j.content}`).join('\n');
  const worst = worstJokes.map(j => `- ${j.content}`).join('\n');

  return `Tu es un humoriste français avec un humour noir, absurde et cynique.

OBJECTIF :
Faire rire, surprendre.

STRUCTURE :
* 1 setup
* 1 punchline

RÈGLES :
* 1 ou 2 phrases max
* pas d'explication
* pas de morale
* punchline imprévisible

MAUVAIS :
* blagues plates
* logique évidente

EXEMPLES DRÔLES :
${best}

À ÉVITER :
${worst}
${recent}

CONSIGNE :
Génère UNE blague avec un vrai twist.`;
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

app.post('/api/generate', async (req, res) => {
  // Best jokes: likes >= 3 AND dislikes = 0
  const bestJokes = db.prepare(`
    SELECT id, content, has_emoji, has_wordplay
    FROM jokes
    WHERE likes >= 3 AND dislikes = 0
    ORDER BY likes DESC
    LIMIT 5
  `).all();

  // Worst jokes: dislikes >= 2
  const worstJokes = db.prepare(`
    SELECT content FROM jokes
    WHERE dislikes >= 2
    ORDER BY rating ASC
    LIMIT 4
  `).all();

  // Recent jokes: last 10 for anti-duplicate
  const recentJokes = db.prepare(`
    SELECT content FROM jokes
    ORDER BY created_at DESC
    LIMIT 10
  `).all();

  let joke = '';
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    const prompt = getPromptForModel(currentModel, bestJokes, recentJokes.slice(0, 5), worstJokes);
    try {
      const out = await callOllama(prompt);
      joke = (typeof out === 'string') ? out.trim() : '';

      // Post-processing
      joke = joke.replace(/^['"-]+/, '').replace(/['"-]+$/, '').trim();

      // Anti-duplicate: compare with 10 dernières
      const isDuplicate = recentJokes.some(r => {
        if (joke.length > 20 && r.content.includes(joke.substring(0, 20))) return true;
        if (r.content.length > 20 && joke.includes(r.content.substring(0, 20))) return true;
        return false;
      });

      if (isDuplicate) {
        attempts++;
        continue;
      }

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
      if (attempts === maxAttempts - 1) {
        res.status(500).json({ error: 'Erreur generation' });
        return;
      }
      attempts++;
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
        const info = db.prepare('INSERT INTO jokes (content, category, rating, likes, dislikes, length, has_emoji, has_wordplay) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(joke, 'joke', rating, rating > 0 ? 1 : 0, rating < 0 ? 1 : 0, features.length, features.has_emoji, features.has_wordplay);
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
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`HTTP server listening on 0.0.0.0:${PORT}`);
    });
}

module.exports = { validateJoke, getPromptForModel };
