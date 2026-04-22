// Express-based server for Joke Generator
const express = require('express');
const path = require('path');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const Database = require('better-sqlite3');

const db = new Database('jokes.db');
const { runMigrations } = require('./lib/migrations');
runMigrations(db);

const app = express();
const PORT = process.env.PORT || 3000;

const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://ollama:11434').replace(/\/$/, '');
const OLLAMA_URL = `${OLLAMA_HOST}/api/generate`;
// Prefer environment variable (set in docker-compose). Default to llama3:2b
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3:2b';

app.use(cors());
app.use(express.json());

// Serve static files from Vite build 'dist' when available (production),
// otherwise serve the repository root (development / legacy static files).
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  // Fallback to index.html for client-side routing, but let /api/* pass through
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
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

function buildPrompt(bestJokes, stats, recentJokes, worstJokes) {
  // Curated few-shot examples to show desired tone and length
  const curated = [
    "Pourquoi les plongeurs plongent-ils toujours en arrière ? Parce que sinon ils tombent dans le bateau.",
    "J'ai acheté un GPS pour mon frigo: maintenant il sait où je vais, et moi aussi.",
    "Mon réveil et moi, on a un accord: il sonne, je le nie."
  ];

  let p = 'Tu es un humoriste professionnel francophone. Objectif: produire UNE SEULE blague en FRANÇAIS, courte, originale et vraiment drôle.';
  p += `\nFormat attendu: 1 à 2 phrases maximum. Pas d'introduction, pas d'explication, pas de questions rhétoriques qui attendent une réponse; réponds uniquement par la blague.`;

  // Preferences statistiques (aider le model à s'aligner)
  if (stats && stats.totalLikes > 0) {
    p += `\n\nContexte utilisateur: ${stats.totalLikes} blagues aimées. Longueur moyenne: ${Math.round(stats.avgLength || 0)} caractères.`;
    if ((stats.emojiRate || 0) > 0.25) p += ` Les utilisateurs aiment les emojis.`;
    if ((stats.wordplayRate || 0) > 0.15) p += ` Les jeux de mots sont appréciés.`;
  }

  // Provide curated examples to set the tone
  p += `\n\nExemples (ton concis, punchline claire):`;
  curated.forEach(ex => p += `\n- ${ex}`);

  // Add top user-liked examples (few-shot) if any
  if (bestJokes && bestJokes.length > 0) {
    p += `\n\nExemples venant des blagues appréciées par les utilisateurs (s'inspirer du style, pas copier):`;
    bestJokes.forEach(j => {
      const tags = [];
      if (j.has_emoji) tags.push('emoji');
      if (j.has_wordplay) tags.push('wordplay');
      p += `\n- ${j.content} ${tags.length ? '(' + tags.join(', ') + ')' : ''}`;
    });
  }

  // Recent jokes to avoid repeating topics (helps stop the 'escargot' loop)
  if (recentJokes && recentJokes.length > 0) {
    p += `\n\nEvite absolument de réutiliser les mêmes sujets/termes que dans les blagues récentes suivantes:`;
    recentJokes.forEach(r => p += `\n- ${r.content}`);
  }

  // Explicit bans / constraints to fix observed failure modes
  p += `\n\nINTERDIT: ne génère AUCUNE blague sur les sujets: escargot, limace, coquille, animaux, bébés, politique, religion, violence, haine.`;
  p += `\nCONTRAINTES: une blague courte (<=140 caractères de préférence), pas de répétition de sujet, pas d'adresse à la 2e personne qui fait référence au client, pas de références à des blagues précédentes.`;
  p += `\nSi tu dois faire un jeu de mots, qu'il soit précis et court. Si tu veux utiliser un emoji, il doit être pertinent et discret.`;

  p += `\n\nRéponds uniquement par la blague (texte brut). FIN.`;
  return p;
}

async function callOllama(prompt) {
  const payload = {
    model: OLLAMA_MODEL,
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
    const res = await fetch((OLLAMA_HOST + '/api/list').replace(/\/api\/$/, '/api/list'), { method: 'GET' });
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    if (!json) return [];
    // Ollama's CLI 'ollama list' returns names; HTTP API may differ, attempt to extract
    if (Array.isArray(json)) return json.map(m => m.name || m);
    if (json.models && Array.isArray(json.models)) return json.models.map(m => m.name || m.id || m);
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
    if (!m || m === OLLAMA_MODEL) continue;
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
    const prompt = buildPrompt(bestJokes, stats, recentJokes, worstJokes);
    try {
    const out = await generateWithFallback(prompt);
      joke = (typeof out === 'string') ? out.trim() : '';
      
      // Clean
      joke = joke.replace(/^['"-]+/, '').replace(/['"-]+$/, '').trim();
      
      // Validate
      if (joke.length > 15 && joke.length < 250 && !joke.match(/^[QR]:/i)) {
        const exists = db.prepare('SELECT 1 FROM jokes WHERE content = ?').get(joke);
        if (!exists) {
          const features = analyzeJoke(joke);
          const info = db.prepare(`
            INSERT INTO jokes (content, category, length, has_emoji, has_wordplay) 
            VALUES (?, ?, ?, ?, ?)
          `).run(joke, 'joke', features.length, features.has_emoji, features.has_wordplay);
          // also record feedback entry with neutral rating 0 (generated)
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

// Export training dataset in a simple JSONL format: {"prompt":...,"completion":...}
app.get('/admin/export-training', (req, res) => {
  try {
    // Use positive feedback as good examples (rating>0), include curated examples marked approved
    const good = db.prepare('SELECT content FROM feedback WHERE rating > 0 ORDER BY created_at DESC LIMIT 1000').all().map(r => r.content);
    const curated = db.prepare('SELECT content FROM curated_examples WHERE approved = 1').all().map(r => r.content);
    const lines = [];
    curated.forEach(c => lines.push(JSON.stringify({ prompt: 'Génère une blague courte et drôle en français.', completion: c })));
    good.forEach(g => lines.push(JSON.stringify({ prompt: 'Génère une blague courte et drôle en français.', completion: g })));
    res.setHeader('Content-Type', 'application/jsonl');
    res.send(lines.join('\n'));
  } catch (e) {
    res.status(500).json({ error: 'export failed' });
  }
});

// Exports directory and file-based training exporter
const EXPORT_DIR = path.join(__dirname, 'exports');
function ensureExportDir() {
  if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

function buildTrainingLines() {
  const good = db.prepare('SELECT content FROM feedback WHERE rating > 0 ORDER BY created_at DESC LIMIT 1000').all().map(r => r.content || '');
  const curated = db.prepare('SELECT content FROM curated_examples WHERE approved = 1').all().map(r => r.content || '');
  const lines = [];
  curated.forEach(c => lines.push(JSON.stringify({ prompt: 'Génère une blague courte et drôle en français.', completion: c })));
  good.forEach(g => lines.push(JSON.stringify({ prompt: 'Génère une blague courte et drôle en français.', completion: g })));
  return lines;
}

function writeTrainingExportFile() {
  ensureExportDir();
  const lines = buildTrainingLines();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `training-${ts}.jsonl`;
  const filepath = path.join(EXPORT_DIR, filename);
  fs.writeFileSync(filepath, lines.join('\n'));
  console.log('Wrote training export:', filepath);
  return filename;
}

app.get('/admin/trigger-export', (req, res) => {
  try {
    const filename = writeTrainingExportFile();
    res.json({ ok: true, filename, url: `/exports/${filename}` });
  } catch (e) {
    res.status(500).json({ error: 'export failed' });
  }
});

// Serve exports folder (files are created by the server)
ensureExportDir();
app.use('/exports', express.static(EXPORT_DIR));

app.get('/admin/exports-list', (req, res) => {
  try {
    ensureExportDir();
    const files = fs.readdirSync(EXPORT_DIR).filter(f => f.startsWith('training-')).sort().reverse();
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: 'list failed' });
  }
});

// Periodic export: default every 60 minutes; set EXPORT_INTERVAL_MIN=0 to disable
const exportIntervalMin = parseInt(process.env.EXPORT_INTERVAL_MIN || '60', 10);
if (exportIntervalMin > 0) {
  // perform an initial export on startup
  try { writeTrainingExportFile(); } catch (e) { console.error('Initial export failed', e && e.message); }
  setInterval(() => {
    try { writeTrainingExportFile(); } catch (e) { console.error('Periodic export failed', e && e.message); }
  }, exportIntervalMin * 60 * 1000);
  console.log(`Scheduled periodic training exports every ${exportIntervalMin} minutes`);
} else {
  console.log('Periodic training export disabled (EXPORT_INTERVAL_MIN=0)');
}

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

// Log Ollama config at startup
console.log(`Using Ollama host: ${OLLAMA_HOST}, URL: ${OLLAMA_URL}, model: ${OLLAMA_MODEL}`);
