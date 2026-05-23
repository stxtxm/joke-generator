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

// ------ Humor styles ------
const HUMOR_STYLES = [
  {
    id: 'dark',
    label: 'Humour noir',
    desc: 'cynique, mordant, décalé. Thèmes : désespoir, solitude, échec, absurdité du quotidien.',
    temperature: 0.9
  },
  {
    id: 'absurd',
    label: 'Absurde',
    desc: 'surréaliste, logique tordue, situations impossibles. Proche de Pierre Desproges.',
    temperature: 0.95
  },
  {
    id: 'observational',
    label: 'Observational',
    desc: 'ironie du quotidien, contradictions sociales. Proche de Raymond Devos.',
    temperature: 0.8
  },
  {
    id: 'cynical',
    label: 'Cynique',
    desc: 'pessimiste, lucide, désabusé mais drôle. Moquerie des travers humains.',
    temperature: 0.85
  },
  {
    id: 'wordplay',
    label: 'Jeux de mots',
    desc: 'calembours, doubles sens, paronomases, contrepèteries légères.',
    temperature: 0.75
  }
];

let styleIndex = 0;
let promptVersion = 1;

function pickStyle() {
  // Epsilon-greedy: 70% exploit best style, 30% explore
  const stylesWithStats = db.prepare(`
    SELECT style, uses, likes, total_rating,
      ROUND(CAST(likes AS REAL) / MAX(uses, 1), 4) as win_rate,
      (CAST(likes AS REAL) + 1.0) / (MAX(uses, 1) + 2.0) as win_rate_laplace
    FROM prompt_styles
    WHERE uses >= 1
    ORDER BY win_rate_laplace DESC
  `).all();

  if (stylesWithStats.length > 0 && Math.random() < 0.7) {
    const best = stylesWithStats[0];
    const found = HUMOR_STYLES.find(s => s.id === best.style);
    if (found) return found;
  }

  const style = HUMOR_STYLES[styleIndex % HUMOR_STYLES.length];
  styleIndex++;
  return style;
}

function recordStyleUsed(style) {
  db.prepare(`
    INSERT INTO prompt_styles (style, uses, likes, dislikes, total_rating)
    VALUES (?, 1, 0, 0, 0)
    ON CONFLICT(style) DO UPDATE SET uses = uses + 1, last_used = CURRENT_TIMESTAMP
  `).run(style);
}

function recordStyleFeedback(style, likeDelta, dislikeDelta, ratingDelta) {
  if (!style) return;
  db.prepare(`
    UPDATE prompt_styles SET
      likes = likes + ?,
      dislikes = dislikes + ?,
      total_rating = total_rating + ?
    WHERE style = ?
  `).run(likeDelta || 0, dislikeDelta || 0, ratingDelta || 0, style);
}

// ------ Analysis ------
function analyzeJoke(joke) {
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]/u;
  const wordplayPatterns = [
    /homophone/i, /double sens/i, /paronomase/i, /calembour/i,
    /play on words/i, /contrep[ée]terie/i
  ];

  return {
    length: joke.length,
    has_emoji: emojiRegex.test(joke) ? 1 : 0,
    has_wordplay: wordplayPatterns.some(p => p.test(joke)) ? 1 : 0
  };
}

// ------ Validation ------
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

  return lower.length > 30 && /[.!?…]$/.test(lower.trim());
}

function validateJoke(joke) {
  const trimmed = joke.trim();
  if (trimmed.length < 20 || trimmed.length > 220) return false;
  const validEndings = ['.', '!', '?', '"', '…'];
  if (!validEndings.some(p => trimmed.endsWith(p))) return false;
  return hasTwist(trimmed);
}

// ------ Duplicate detection with n-gram overlap ------
function ngrams(text, n) {
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length >= 3);
  const result = new Set();
  for (let i = 0; i <= words.length - n; i++) {
    result.add(words.slice(i, i + n).join(' '));
  }
  return result;
}

function isTooSimilar(a, b, totalJokes = 0) {
  if (a.length < 20 || b.length < 20) return a.includes(b.substring(0, 15)) || b.includes(a.substring(0, 15));
  const bigramsA = ngrams(a, 2);
  const bigramsB = ngrams(b, 2);
  if (bigramsA.size === 0 || bigramsB.size === 0) return false;
  let overlap = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) overlap++;
  }
  // Adaptive threshold: stricter as DB grows
  const threshold = totalJokes >= 20 ? 0.35 : totalJokes >= 10 ? 0.40 : 0.50;
  return overlap / Math.min(bigramsA.size, bigramsB.size) > threshold;
}

// ------ Prompt generation ------
function getTargetLength(bestJokes) {
  const lengths = bestJokes.map(j => (j.content || '').length).filter(l => l > 0);
  if (lengths.length < 2) return 'courte et percutante';
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (avg < 50) return 'très concise, une phrase courte';
  if (avg < 80) return 'moyenne, deux phrases max';
  if (avg < 110) return 'un peu développée mais punchline courte';
  return 'courte et percutante';
}

function getPromptForModel(model, bestJokes, recentJokes, worstJokes, style, stats = {}) {
  const curatedBest = db.prepare(`
    SELECT content FROM curated_examples WHERE approved = 1 ORDER BY RANDOM() LIMIT 3
  `).all();

  const bestExamples = [...curatedBest, ...bestJokes].slice(0, 4);
  const bestText = bestExamples.map(j => `- ${j.content}`).join('\n');
  const recentText = recentJokes.slice(0, 3).map(j => `- ${j.content}`).join('\n');
  const worstText = worstJokes.slice(0, 3).map(j => `- ${j.content}`).join('\n');
  const lengthGuide = getTargetLength(bestJokes);

  let styleHints = '';
  if (stats.wordplayRate >= 0.5) styleHints += '\n* les blagues les mieux notées utilisent des jeux de mots';
  if (stats.emojiRate >= 0.4) styleHints += '\n* les emojis sont appréciés';
  if (stats.avgLength && stats.avgLength > 0) {
    styleHints += `\n* la longueur idéale est d'environ ${Math.round(stats.avgLength)} caractères`;
  }

  return `Tu es un humoriste français. Style demandé : ${style.label}.

DESCRIPTION DU STYLE :
${style.desc}

RÈGLES STRICTES :
* 1 ou 2 phrases max
* pas de texte d'introduction ("voici", "je vous propose")
* pas d'explication après la chute
* pas de morale
* réponse directe : UNE SEULE BLAGUE, RIEN D'AUTRE

LONGUEUR : ${lengthGuide}
TON : ${style.desc}

ANTI-PATRONS (ne surtout pas faire) :
${worstText || '* blagues prévisibles\n* logique trop évidente\n* chute attendue'}

EXEMPLES QUI MARCHENT BIEN :
${bestText || 'Aucun pour le moment'}

ÉVITE CES THÈMES DÉJÀ VUS (ne pas répéter) :
${recentText || 'Aucun pour le moment'}
${styleHints}

CONSIGNE FINALE :
Génère UNE blague en français avec un vrai twist, dans le style "${style.label}".`;
}

// ------ API calls ------
async function callOllama(prompt, temperature) {
  const payload = {
    model: currentModel,
    prompt,
    stream: false,
    options: { temperature, num_predict: 150, top_p: 0.92 }
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

function cleanJoke(joke) {
  let cleaned = joke.trim();
  cleaned = cleaned.replace(/^['"-]+/, '').replace(/['"-]+$/, '').trim();

  const lines = cleaned.split('\n').filter(l => {
    const t = l.trim();
    if (!t) return false;
    if (/^(Voici|voici|Je vous propose|En voici|Génér[ée]|Je g[ée]n[èe]re|Setup|Punchline|Bienvenue|Salut|Bonjour|Réponse|Blague|Titre)/i.test(t)) return false;
    return true;
  });
  cleaned = lines.join(' ').replace(/^['"'*\-–—\s]+|['"'*\-–—\s]+$/g, '').trim();

  return cleaned;
}

// ------ Auto-curation ------
function autoCurate() {
  const candidates = db.prepare(`
    SELECT content FROM jokes
    WHERE (likes > 0 AND dislikes = 0 AND rating >= 2)
    AND content NOT IN (SELECT content FROM curated_examples)
  `).all();

  const ins = db.prepare('INSERT OR IGNORE INTO curated_examples (content, approved, notes) VALUES (?, 1, ?)');
  for (const c of candidates) {
    ins.run(c.content, 'auto-curated (likes>=2, dislikes=0)');
  }
}

// ------ Endpoints ------
app.post('/api/generate', async (req, res) => {
  const totalJokes = db.prepare('SELECT COUNT(1) as c FROM jokes').get().c;

  const bestJokes = db.prepare(`
    SELECT id, content, has_emoji, has_wordplay
    FROM jokes
    WHERE likes >= 1 AND dislikes = 0
    ORDER BY
      (likes * 2.0 + rating) / MAX(1.0, (julianday('now') - julianday(created_at)) * 0.1 + 1.0) DESC,
      rating DESC
    LIMIT 5
  `).all();

  const worstJokes = db.prepare(`
    SELECT content FROM jokes
    WHERE dislikes >= 1 AND likes = 0
    ORDER BY
      (dislikes * 2.0 - rating) / MAX(1.0, (julianday('now') - julianday(created_at)) * 0.1 + 1.0) DESC,
      created_at DESC
    LIMIT 4
  `).all();

  const recentJokes = db.prepare(`
    SELECT content FROM jokes
    ORDER BY created_at DESC
    LIMIT 10
  `).all();

  const style = pickStyle();

  let joke = '';
  let attempts = 0;
  const maxAttempts = 3;

  const stats = {
    wordplayRate: bestJokes.filter(j => j.has_wordplay).length / Math.max(bestJokes.length, 1),
    emojiRate: bestJokes.filter(j => j.has_emoji).length / Math.max(bestJokes.length, 1),
    avgLength: bestJokes.length ? bestJokes.reduce((s, j) => s + (j.content || '').length, 0) / bestJokes.length : 50
  };

  while (attempts < maxAttempts) {
    const prompt = getPromptForModel(currentModel, bestJokes, recentJokes, worstJokes, style, stats);
    try {
      let out;
      if (currentModel === 'gpto') {
        out = await callGpto(prompt);
      } else {
        out = await callOllama(prompt, style.temperature);
      }
      joke = (typeof out === 'string') ? out.trim() : '';
      joke = cleanJoke(joke);

      const isDuplicate = recentJokes.some(r => isTooSimilar(joke, r.content, totalJokes));
      if (isDuplicate) {
        attempts++;
        continue;
      }

      if (validateJoke(joke)) {
        const exists = db.prepare('SELECT 1 FROM jokes WHERE content = ?').get(joke);
        if (!exists) {
          const features = analyzeJoke(joke);
          const info = db.prepare(`
            INSERT INTO jokes (content, category, length, has_emoji, has_wordplay, prompt_style, temperature, prompt_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(joke, style.id, features.length, features.has_emoji, features.has_wordplay, style.id, style.temperature, promptVersion);
          db.prepare(`INSERT INTO feedback (joke_id, content, rating, length, has_emoji, has_wordplay, prompt_style) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(info.lastInsertRowid, joke, 0, features.length, features.has_emoji, features.has_wordplay, style.id);
          recordStyleUsed(style.id);
          autoCurate();
          res.json({ joke, style: style.label });
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

    const row = db.prepare('SELECT id, prompt_style, likes, dislikes, rating FROM jokes WHERE content = ?').get(joke);
    if (row) {
        let newLikes = row.likes;
        let newDislikes = row.dislikes;

        if (rating > 0) {
          if (row.likes > 0) {
            // Already liked → no change (idempotent)
          } else if (row.dislikes > 0) {
            newLikes = 1; newDislikes = 0;
          } else {
            newLikes = 1; newDislikes = 0;
          }
        } else if (rating < 0) {
          if (row.dislikes > 0) {
            // Already disliked → no change (idempotent)
          } else if (row.likes > 0) {
            newLikes = 0; newDislikes = 1;
          } else {
            newLikes = 0; newDislikes = 1;
          }
        } else {
          newLikes = 0; newDislikes = 0;
        }

        const likeDelta = newLikes - row.likes;
        const dislikeDelta = newDislikes - row.dislikes;
        const ratingDelta = likeDelta - dislikeDelta;

        db.prepare('UPDATE jokes SET rating = rating + ?, likes = ?, dislikes = ? WHERE id = ?')
          .run(ratingDelta, newLikes, newDislikes, row.id);
        db.prepare('INSERT INTO feedback (joke_id, content, rating, length, has_emoji, has_wordplay, prompt_style) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(row.id, joke, ratingDelta, features.length, features.has_emoji, features.has_wordplay, row.prompt_style);
        if (row.prompt_style && (likeDelta !== 0 || dislikeDelta !== 0)) {
          recordStyleFeedback(row.prompt_style, likeDelta, dislikeDelta, ratingDelta);
          db.prepare('INSERT INTO style_log (style, joke_id, rating) VALUES (?, ?, ?)').run(row.prompt_style, row.id, ratingDelta);
        }
        autoCurate();
    } else {
        const likes = rating > 0 ? 1 : 0;
        const dislikes = rating < 0 ? 1 : 0;
        const info = db.prepare('INSERT INTO jokes (content, category, rating, likes, dislikes, length, has_emoji, has_wordplay) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(joke, 'joke', rating, likes, dislikes, features.length, features.has_emoji, features.has_wordplay);
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

app.get('/admin/style-stats', (req, res) => {
  const styles = db.prepare(`
    SELECT style, uses, likes, dislikes, total_rating,
      ROUND(CAST(likes AS REAL) / MAX(uses, 1), 2) as like_rate,
      ROUND(CAST(total_rating AS REAL) / MAX(uses, 1), 2) as avg_rating
    FROM prompt_styles ORDER BY like_rate DESC
  `).all();

  const bestStyle = db.prepare(`
    SELECT style, ROUND(AVG(rating), 2) as avg_rating, COUNT(*) as count
    FROM style_log GROUP BY style ORDER BY avg_rating DESC
  `).all();

  res.json({ styleStats: styles, bestPerformers: bestStyle });
});

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`HTTP server listening on 0.0.0.0:${PORT}`);
    });
}

module.exports = { app, validateJoke, getPromptForModel, HUMOR_STYLES, pickStyle };