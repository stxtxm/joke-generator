const express = require('express');
const path = require('path');
const cors = require('cors');
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

let currentModel = 'llama3.2:3b';

const { getAvailableModels } = require('./lib/models');

app.use(cors());
app.use(express.json());

const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/admin/')) return next();
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
    /play on words/i
  ];

  return {
    length: joke.length,
    has_emoji: emojiRegex.test(joke) ? 1 : 0,
    has_wordplay: wordplayPatterns.some(p => p.test(joke)) ? 1 : 0
  };
}

function hasTwist(joke) {
  const lower = joke.toLowerCase();

  if (lower.includes('?')) {
    const parts = joke.split('?');
    if (parts.length < 2) return false;
    const setup = parts[0].toLowerCase();
    const punchline = parts.slice(1).join('?').trim().toLowerCase();
    if (punchline.length < 10) return false;

    const contradictionWords = ['mais', 'pourtant', 'cependant', 'alors que', 'sauf que'];
    if (contradictionWords.some(w => punchline.includes(w))) return true;

    const twistWords = ['parce que', 'simplement parce', 'en fait', 'finalement'];
    if (twistWords.some(w => punchline.includes(w))) return true;

    const setupWords = new Set(setup.split(/\W+/).filter(w => w.length > 3));
    const punchWords = new Set(punchline.split(/\W+/).filter(w => w.length > 3));
    let common = 0;
    for (const w of punchWords) { if (setupWords.has(w)) common++; }
    if (punchWords.size > 0 && common / punchWords.size > 0.6) return false;

    const cynicalPatterns = [
      /parce qu(e|\')/,
      /personne ne/,
      /tout simplement/,
      /la vérité/,
      /plus simple que/,
      /fuir|fuyez/
    ];
    if (cynicalPatterns.some(p => punchline.match(p))) return true;

    return punchline.length > 15;
  }

  const twistIndicators = [
    'parce que', 'mais', 'pourtant', 'cependant', 'en fait',
    'finalement', 'tout simplement', 'la vérité'
  ];
  if (twistIndicators.some(w => lower.includes(w))) return true;

  return lower.length > 30 && /[.!?]$/.test(lower.trim());
}

function validateJoke(joke) {
  const trimmed = joke.trim();
  if (trimmed.length < 20 || trimmed.length > 220) return false;
  const validEndings = ['.', '!', '?', '"', '…'];
  if (!validEndings.some(p => trimmed.endsWith(p))) return false;
  return hasTwist(trimmed);
}

function getPromptForModel(model, bestJokes, recentJokes, worstJokes, stats = {}) {
  const best = bestJokes.map(j => `- ${j.content}`).join('\n');
  const recent = recentJokes.map(j => `- ${j.content}`).join('\n');
  const worst = worstJokes.map(j => `- ${j.content}`).join('\n');

  let styleHints = '';
  if (stats.wordplayRate >= 0.6) styleHints += '\n* privilégie les jeux de mots';
  if (stats.emojiRate >= 0.6) styleHints += '\n* utilise souvent des emojis';
  if (stats.avgLength < 50) styleHints += '\n* très concis';
  else if (stats.avgLength <= 90) styleHints += '\n* longueur moyenne';
  else styleHints += '\n* plutôt long mais percutant';

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
${best || 'Aucun pour le moment'}

À ÉVITER :
${worst || 'Aucun pour le moment'}
${recent || 'Aucun pour le moment'}
STYLE${styleHints}

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
  const id = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch('http://joke-ollama:11434/api/generate', {
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

async function callGpto(prompt) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch('http://gpto-service:8000/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal
    });

    clearTimeout(id);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `GPTO error: ${res.status}`);
    }

    const data = await res.json();
    return data.response || '';
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

app.post('/api/generate', async (req, res) => {
  const bestJokes = db.prepare(`
    SELECT id, content, has_emoji, has_wordplay
    FROM jokes
    WHERE likes >= 3 AND dislikes = 0
    ORDER BY likes DESC
    LIMIT 5
  `).all();

  const worstJokes = db.prepare(`
    SELECT content FROM jokes
    WHERE dislikes >= 2
    ORDER BY rating ASC
    LIMIT 4
  `).all();

  const recentJokes = db.prepare(`
    SELECT content FROM jokes
    ORDER BY created_at DESC
    LIMIT 10
  `).all();

  let joke = '';
  let attempts = 0;
  const maxAttempts = 3;

  const stats = {
    wordplayRate: bestJokes.filter(j => j.has_wordplay).length / Math.max(bestJokes.length, 1),
    emojiRate: bestJokes.filter(j => j.has_emoji).length / Math.max(bestJokes.length, 1),
    avgLength: bestJokes.length ? bestJokes.reduce((s, j) => s + (j.content || '').length, 0) / bestJokes.length : 50
  };

  while (attempts < maxAttempts) {
    const prompt = getPromptForModel(currentModel, bestJokes, recentJokes.slice(0, 5), worstJokes, stats);
    try {
      let out;
      if (currentModel === 'gpto') {
        out = await callGpto(prompt);
      } else {
        out = await callOllama(prompt);
      }
      joke = (typeof out === 'string') ? out.trim() : '';

      joke = joke.replace(/^['"-]+/, '').replace(/['"-]+$/, '').trim();

      const lines = joke.split('\n').filter(l => {
        const t = l.trim();
        if (!t) return false;
        if (/^(Voici|voici|Je vous propose|En voici|Génér[ée]|Je g[ée]n[èe]re|Setup|Punchline|Bienvenue|Salut|Bonjour)/i.test(t)) return false;
        return true;
      });
      joke = lines.join(' ').replace(/^['"'*\-–—\s]+|['"'*\-–—\s]+$/g, '').trim();

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
    const { joke, rating } = req.body;
    if (!joke || typeof rating === 'undefined') return res.status(400).send();

    const features = analyzeJoke(joke);

    const row = db.prepare('SELECT id FROM jokes WHERE content = ?').get(joke);
    if (row) {
        db.prepare('UPDATE jokes SET rating = rating + ?, likes = likes + ?, dislikes = dislikes + ? WHERE id = ?')
          .run(rating, rating > 0 ? 1 : 0, rating < 0 ? 1 : 0, row.id);
        db.prepare('INSERT INTO feedback (joke_id, content, rating, length, has_emoji, has_wordplay) VALUES (?, ?, ?, ?, ?, ?)')
          .run(row.id, joke, rating, features.length, features.has_emoji, features.has_wordplay);
    } else {
        const info = db.prepare('INSERT INTO jokes (content, category, rating, likes, dislikes, length, has_emoji, has_wordplay) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(joke, 'joke', rating, rating > 0 ? 1 : 0, rating < 0 ? 1 : 0, features.length, features.has_emoji, features.has_wordplay);
        db.prepare('INSERT INTO feedback (joke_id, content, rating, length, has_emoji, has_wordplay) VALUES (?, ?, ?, ?, ?, ?)')
          .run(info.lastInsertRowid, joke, rating, features.length, features.has_emoji, features.has_wordplay);
    }

    const metrics = db.prepare('SELECT likes, dislikes, rating FROM jokes WHERE content = ?').get(joke) || { likes: 0, dislikes: 0, rating: 0 };
    res.json({ ok: true, metrics });
});

app.get('/api/joke/metrics', (req, res) => {
    const content = req.query.content || '';
    if (!content) return res.json({ likes: 0, dislikes: 0, rating: 0 });
    const row = db.prepare('SELECT likes, dislikes, rating FROM jokes WHERE content = ?').get(content);
    if (!row) return res.json({ likes: 0, dislikes: 0, rating: 0 });
    res.json(row);
});

// --- Admin ---
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

app.get('/admin/curated', (req, res) => {
  const rows = db.prepare('SELECT * FROM curated_examples ORDER BY created_at DESC').all();
  res.json(rows);
});

app.post('/admin/curated', (req, res) => {
  const { content, notes, approved } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  try {
    db.prepare('INSERT INTO curated_examples (content, notes, approved) VALUES (?, ?, ?)')
      .run(content, notes || '', approved ? 1 : 0);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/admin/curated/:id', (req, res) => {
  db.prepare('DELETE FROM curated_examples WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
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

module.exports = { app, validateJoke, getPromptForModel };