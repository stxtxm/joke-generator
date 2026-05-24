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

let currentModel = 'gemini';

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

const FALLBACK_JOKES = [
  "J'ai un ami qui est mort d'une overdose de Viagra. Le plus dur pour sa famille, ça a été de fermer le cercueil.",
  "L'avantage avec les orphelins, c'est que tu peux pas les menacer d'appeler leurs parents.",
  "C'est un mec qui tweete : 'Je viens de percuter un piéton, je fais quoi ?' Un internaute répond : 'Recule pour être sûr, ça t'évitera de payer les frais d'hôpital pendant 40 ans.'",
  "Ma grand-mère m'a dit : 'À mon époque, on n'avait pas besoin de thérapeute, on réglait nos problèmes nous-mêmes.' Du coup je lui ai rappelé que son frère est mort d'un duel à la carabine pour une histoire de poule."
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

// ------ Adaptive rules (feedback loop) ------
function extractJokePatterns(joke) {
  const patterns = [];
  const lower = joke.trim().toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const firstWord = words[0] || '';
  const firstTwo = words.slice(0, 2).join(' ');

  if (firstWord) patterns.push(`start:${firstWord.replace(/[^a-z0-9éèàùêâîôûäëïöü']/g, '')}`);
  if (firstTwo && words.length >= 2) patterns.push(`start2:${firstTwo.replace(/[^a-z0-9éèàùêâîôûäëïöü' ]/g, '')}`);

  if (/^j['\s]ai/.test(lower)) patterns.push('starts_with:j_ai');
  if (/^c['\s]est/.test(lower)) patterns.push('starts_with:c_est');

  const len = joke.trim().length;
  if (len < 50) patterns.push('length:short');
  else if (len < 100) patterns.push('length:medium');
  else patterns.push('length:long');

  return patterns;
}

function updatePromptRules(joke, isLike) {
  const patterns = extractJokePatterns(joke);
  const upsert = db.prepare(`
    INSERT INTO prompt_rules (pattern, likes, dislikes, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(pattern) DO UPDATE SET
      likes = likes + ?,
      dislikes = dislikes + ?,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const pattern of patterns) {
    upsert.run(pattern, isLike ? 1 : 0, isLike ? 0 : 1, isLike ? 1 : 0, isLike ? 0 : 1);
  }
}

function getAdaptiveRules() {
  const rows = db.prepare(`
    SELECT pattern, likes, dislikes,
      ROUND(CAST(likes AS REAL) / MAX(likes + dislikes, 1), 2) as like_rate,
      (likes + dislikes) as total
    FROM prompt_rules
    WHERE (likes + dislikes) >= 4
    ORDER BY total DESC, like_rate DESC
    LIMIT 15
  `).all();

  const totalEvals = rows.reduce((s, r) => s + r.total, 0);
  if (totalEvals < 6) return { avoid: [], encourage: [] };

  const avoid = rows
    .filter(r => r.like_rate < 0.4 && (r.pattern.startsWith('start:') || r.pattern.startsWith('starts_with:')))
    .slice(0, 3)
    .map(r => r.pattern);

  const encourage = rows
    .filter(r => r.like_rate >= 0.6 && r.pattern.startsWith('length:'))
    .slice(0, 2)
    .map(r => r.pattern);

  return { avoid, encourage };
}

function formatPromptPattern(pattern) {
  const map = {
    'starts_with:j_ai': 'commencer par "J\'ai"',
    'starts_with:c_est': 'commencer par "C\'est"',
    'length:short': 'blague très courte',
    'length:medium': 'blague de longueur moyenne',
    'length:long': 'blague développée'
  };
  if (map[pattern]) return map[pattern];
  if (pattern.startsWith('start:')) return `commencer par "${pattern.slice(6)}"`;
  if (pattern.startsWith('start2:')) return `commencer par "${pattern.slice(7)}"`;
  return pattern;
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

function getFallbackJoke() {
  return FALLBACK_JOKES[Math.floor(Math.random() * FALLBACK_JOKES.length)];
}

function getOllamaPrompt(bestJokes, style) {
  const example = bestJokes.length > 0 ? bestJokes[0].content : getFallbackJoke();
  return `Style: ${style.label}
Exemple: ${example}
Génère UNE blague en français. Pas de "Pourquoi". Pas de "J'ai". Varie la structure.`;
}

function getGeminiPrompt(bestJokes, recentJokes, worstJokes, style, stats = {}) {
  const bestText = bestJokes.slice(0, 4).map(j => `- ${j.content}`).join('\n') || `- ${getFallbackJoke()}`;
  const worstText = worstJokes.slice(0, 3).map(j => `- ${j.content}`).join('\n');
  const recentText = recentJokes.slice(0, 3).map(j => `- ${j.content}`).join('\n');
  const lengthGuide = getTargetLength(bestJokes);
  const { avoid, encourage } = getAdaptiveRules();

  let styleHints = '';
  if (stats.wordplayRate >= 0.5) styleHints += '\n- les blagues que tu as aimées utilisent des jeux de mots';
  if (stats.emojiRate >= 0.4) styleHints += '\n- les emojis sont appréciés';
  if (stats.avgLength && stats.avgLength > 0) {
    styleHints += `\n- la longueur idéale est d'environ ${Math.round(stats.avgLength)} caractères`;
  }

  let adaptiveSection = '';
  if (avoid.length > 0) {
    adaptiveSection += `\nÉVITE ABSOLUMENT ces structures (mal notées par le passé) :\n${avoid.map(p => `- ${formatPromptPattern(p)}`).join('\n')}\n`;
  }
  if (encourage.length > 0) {
    adaptiveSection += `\nPRIVILÉGIE ces structures (bien notées par le passé) :\n${encourage.map(p => `- ${formatPromptPattern(p)}`).join('\n')}\n`;
  }

  return `Tu es un humoriste français. Style demandé : ${style.label}.

DESCRIPTION DU STYLE :
${style.desc}

EXEMPLES VALIDÉS (tu as aimé ces blagues — inspire-toi de leur structure et de leur ton) :
${bestText}

${worstText ? `CONTRE-EXEMPLES (tu n'as PAS aimé ces blagues — évite ce genre de chute) :\n${worstText}\n` : ''}
${recentText ? `THÈMES DÉJÀ VUS (ne pas répéter) :\n${recentText}\n` : ''}
${adaptiveSection}
RÈGLES STRICTES :
* 1 ou 2 phrases max
* NE COMMENCE JAMAIS par "J'ai", "C'est", "Un", "Une", "Il", "Elle"
* VARIATION OBLIGATOIRE : alterne les structures (question rhétorique, constat absurde, parallèle inattendu, situation hypothétique)
* pas de texte d'introduction ("voici", "je vous propose", "en voici une")
* pas d'explication après la chute
* pas de morale
* réponse directe : UNE SEULE BLAGUE, RIEN D'AUTRE

LONGUEUR : ${lengthGuide}
${styleHints}

CONSIGNE FINALE :
Génère UNE blague en français avec un vrai twist, dans le style "${style.label}". Trouve un angle original — évite les formulations attendues.`;
}

// ------ API calls ------
async function callOllama(prompt, temperature) {
  const model = currentModel === 'gemini' ? (process.env.OLLAMA_MODEL || 'qwen2.5:1.5b') : currentModel;
  const payload = {
    model,
    prompt,
    stream: false,
    options: { temperature, num_predict: 40, top_p: 0.85, top_k: 40, num_ctx: 512 }
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

async function callGemini(prompt) {
  const geminiPath = '/usr/local/lib/node_modules/@google/gemini-cli/bundle/gemini.js';
  const fs = require('fs');
  if (!fs.existsSync(geminiPath)) {
    console.log('gemini-cli not found at ' + geminiPath);
    return '';
  }

  const { execFile } = require('child_process');
  return new Promise((resolve) => {
    const child = execFile('node', [
      geminiPath,
      '--skip-trust',
      '-p', prompt,
      '-m', 'gemini-2.5-flash-lite',
      '-o', 'text'
    ], {
      timeout: 120000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, NODE_PATH: '/usr/local/lib/node_modules', GEMINI_CLI_TRUST_WORKSPACE: 'true' }
    }, (err, stdout, stderr) => {
      if (err) {
        console.log('Gemini CLI error:', err.message);
        resolve('');
        return;
      }
      const text = stdout.trim();
      if (text) console.log('Gemini CLI OK');
      resolve(text);
    });
  });
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
    try {
      let out;
      if (currentModel === 'gemini') {
        const prompt = getGeminiPrompt(bestJokes, recentJokes, worstJokes, style, stats);
        out = await callGemini(prompt);
        if (!out) {
          console.log('Gemini failed, falling back to Ollama');
          const fallbackPrompt = getOllamaPrompt(bestJokes, style);
          out = await callOllama(fallbackPrompt, style.temperature);
          if (out) console.log(`Ollama fallback OK: ${out.slice(0, 60)}...`);
          else console.log('Ollama fallback returned empty');
        }
      } else {
        const prompt = getOllamaPrompt(bestJokes, style);
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
          updatePromptRules(joke, rating > 0);
        }
    } else {
        const likes = rating > 0 ? 1 : 0;
        const dislikes = rating < 0 ? 1 : 0;
        const info = db.prepare('INSERT INTO jokes (content, category, rating, likes, dislikes, length, has_emoji, has_wordplay) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(joke, 'joke', rating, likes, dislikes, features.length, features.has_emoji, features.has_wordplay);
        db.prepare('INSERT INTO feedback (joke_id, content, rating, length, has_emoji, has_wordplay) VALUES (?, ?, ?, ?, ?, ?)')
          .run(info.lastInsertRowid, joke, rating, features.length, features.has_emoji, features.has_wordplay);
        updatePromptRules(joke, rating > 0);
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

app.post('/admin/reset-rules', (req, res) => {
  try {
    db.prepare('DELETE FROM prompt_rules').run();
    res.json({ ok: true, message: 'Prompt rules reset' });
  } catch (e) {
    res.status(500).json({ error: e.message });
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

module.exports = { app, validateJoke, getOllamaPrompt, getGeminiPrompt, getFallbackJoke, HUMOR_STYLES, pickStyle, getAdaptiveRules };