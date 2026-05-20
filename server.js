// Express-based server for Joke Generator
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { spawn } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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

// NEW: Generation mode - Default to gemini as requested
let GENERATION_MODE = process.env.GENERATION_MODE || 'gemini';

const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://ollama:11434').replace(/\/$/, '');
const OLLAMA_URL = `${OLLAMA_HOST}/api/generate`;

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

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
  if (trimmed.length < 20 || trimmed.length > 180) {
    console.log(`[DEBUG] Joke failed length check: ${trimmed.length} chars`);
    return false;
  }
  // Must end with terminal punctuation
  const validEndings = ['.', '!', '?', '"', '...'];
  if (!validEndings.some(p => trimmed.endsWith(p))) {
    console.log(`[DEBUG] Joke failed ending check: "${trimmed.slice(-5)}"`);
    return false;
  }
  // Twist detection heuristics
  const result = hasTwist(trimmed);
  if (!result) console.log(`[DEBUG] Joke failed twist detection`);
  return result;
}

// Twist detection: contradiction logique, chute inattendue, changement de sens
function hasTwist(joke) {
  const lower = joke.toLowerCase();
  
  // Format 1: Question/Réponse
  if (lower.includes('?')) {
    const parts = joke.split('?');
    if (parts.length >= 2) {
      const setup = parts[0].toLowerCase();
      const punchline = parts.slice(1).join('?').trim().toLowerCase();
      if (punchline.length >= 10) return true;
    }
  }
  
  // Format 2: Assertion avec chute (virgule, deux points, ou point)
  const separators = [':', '...', '. '];
  for (const sep of separators) {
    if (joke.includes(sep)) {
      const parts = joke.split(sep);
      const punchline = parts[parts.length - 1].trim();
      if (punchline.length >= 15 && parts[0].length >= 15) return true;
    }
  }

  // Fallback: si la blague est assez longue et contient des mots clés cyniques
  const cynicalPatterns = [
    /parce qu(e|\')/, /personne ne/, /tout simplement/, /la vérité/,
    /plus simple que/, /fuir|fuyez/, /mort s'ensuive/, /produit de luxe/,
    /c'est juste/, /c'est comme/
  ];
  if (joke.length > 50 && cynicalPatterns.some(p => lower.match(p))) return true;

  return false;
}

function getPromptForModel(model, bestJokes, recentJokes, worstJokes, stats) {
  const best = bestJokes.map(j => `- ${j.content}`).join('\n');
  const recent = recentJokes.map(j => `- ${j.content}`).join('\n');
  const worst = worstJokes.map(j => `- ${j.content}`).join('\n');

  // Simple progress: the model can adapt based on these stats
  const advice = [];
  if (stats.wordplayRate > 0.5) advice.push('privilégie les jeux de mots');
  if (stats.emojiRate > 0.5) advice.push('utilise souvent des emojis');
  if (stats.avgLength < 60) advice.push('très concis');

  return `Tu es un humoriste français sarcastique et inventif.

RÈGLES STRICTES :
1. Génère UNE SEULE blague courte (max 150 caractères).
2. DIVERSITÉ : N'utilise PAS toujours le format "Pourquoi...". Varie avec des affirmations, des définitions absurdes, des observations cyniques, ou des détournements de situations quotidiennes.
3. STRUCTURE : Chute inattendue, cynique ou absurde.
4. PAS d'introduction, PAS de métadonnées.
5. CONSEILS (basés sur tes succès passés) : ${advice.join(', ')}.

EXEMPLES À SUIVRE (Style attendu) :
- La vie est une maladie sexuellement transmissible mortelle à 100%.
- J'ai décidé de vendre ma maison pour acheter un van. Maintenant, je vis dans un van garé devant mon ancienne maison.
- Le mariage est juste un contrat qui autorise une personne à décider quelle température il fait dans la chambre.
- Si le travail c'est la santé, donnez le mien à un malade.

EXEMPLES RÉCENTS (À NE PAS COPIER) :
${recent}

INSPIRATIONS (Les meilleures) :
${best}

À ÉVITER (Les pires) :
${worst}

Génère maintenant :`;
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

async function callGemini(prompt, retries = 3, delay = 5000) {
  try {
    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (e) {
    if (e.status === 429 && retries > 0) {
      console.warn(`Gemini 429 error, retrying in ${delay}ms... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return callGemini(prompt, retries - 1, delay * 2);
    }
    console.error('--- GENERATION ERROR START ---');
    console.error('Error Details:', e);
    console.error('--- GENERATION ERROR END ---');
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
    // Collect stats to help the model learn
    const stats = db.prepare(`
        SELECT 
            AVG(has_wordplay) as wordplayRate, 
            AVG(has_emoji) as emojiRate, 
            AVG(length) as avgLength
        FROM jokes
        WHERE likes > dislikes
    `).get() || { wordplayRate: 0, emojiRate: 0, avgLength: 100 };

    const prompt = getPromptForModel(currentModel, bestJokes, recentJokes.slice(0, 5), worstJokes, stats);
    try {
      let out;
      if (GENERATION_MODE === 'gemini') {
          out = await callGemini(prompt);
      } else {
          out = await callOllama(prompt);
      }
      joke = (typeof out === 'string') ? out.trim() : '';
      console.log(`[DEBUG] Raw joke from ${GENERATION_MODE}: "${joke}"`);

      if (!joke) {
        console.log(`[DEBUG] Empty joke from ${GENERATION_MODE}, attempt ${attempts + 1}`);
        attempts++;
        continue;
      }

      // Post-processing
      joke = joke.replace(/^['"-]+/, '').replace(/['"-]+$/, '').trim();

      // Anti-duplicate: compare with 10 dernières
      const isDuplicate = recentJokes.some(r => {
        if (joke.length > 20 && r.content.includes(joke.substring(0, 20))) return true;
        if (r.content.length > 20 && joke.includes(r.content.substring(0, 20))) return true;
        return false;
      });

      if (isDuplicate) {
        console.log(`[DEBUG] Duplicate joke, attempt ${attempts + 1}`);
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
      console.error('--- GENERATION ERROR START ---');
      console.error('Error Details:', e);
      console.error('--- GENERATION ERROR END ---');
      if (attempts === maxAttempts - 1) {
        res.status(500).json({ error: 'Erreur generation: ' + e.message });
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

// --- Admin: Curated Examples ---
app.get('/admin/curated', (req, res) => {
    const examples = db.prepare('SELECT * FROM curated_examples ORDER BY id DESC').all();
    res.json(examples);
});

app.post('/admin/curated', (req, res) => {
    const { content, approved, notes } = req.body;
    db.prepare('INSERT INTO curated_examples (content, approved, notes) VALUES (?, ?, ?)').run(content, approved, notes);
    res.json({ ok: true });
});

app.delete('/admin/curated/:id', (req, res) => {
    db.prepare('DELETE FROM curated_examples WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

// --- Admin: Model management ---
const { getAvailableModels } = require('./lib/models');
const { runMigrations } = require('./lib/migrations');
// ...
app.get('/admin/models', async (req, res) => {
  const models = await getAvailableModels();
  res.json({ models, current: currentModel, mode: GENERATION_MODE });
});

app.post('/admin/set-model', (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).send();
  
  if (model === 'gemini-flash-latest') {
    GENERATION_MODE = 'gemini';
  } else {
    GENERATION_MODE = 'ollama';
    currentModel = model;
  }
  
  console.log(`Model switched to: ${model}, Mode: ${GENERATION_MODE}`);
  res.json({ ok: true, current: model, mode: GENERATION_MODE });
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
