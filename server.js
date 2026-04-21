// Express-based server for Joke Generator
// - Mobile-first frontend served from index.html
// - POST /api/generate -> calls local Ollama API
// - GET  /api/health    -> quick model check

const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Ollama configuration (when running in docker-compose the host is 'ollama')
const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://ollama:11434').replace(/\/$/, '');
const OLLAMA_URL = `${OLLAMA_HOST}/api/generate`;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b-lowram';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

function buildPrompt(style, topic) {
  let p = 'You are a witty, friendly comedian. Produce a short, funny joke.';
  if (style) p += ` Style: ${style}.`;
  if (topic) p += ` Topic: ${topic}.`;
  p += ' Keep it concise, safe for general audiences, and avoid disclaimers.';
  return p;
}

async function callOllama(prompt, timeoutMs = 30000) {
  const payload = {
    model: OLLAMA_MODEL,
    prompt,
    stream: false,
    options: { temperature: 0.8, num_predict: 200 }
  };

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(id);

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Ollama returned ${res.status}: ${txt}`);
    }

    const json = await res.json().catch(() => null);
    if (!json) return '';
    return typeof json === 'string' ? json : (json.response || JSON.stringify(json));
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// Health endpoint
app.get('/api/health', async (req, res) => {
  try {
    const sample = await callOllama('Say pong.');
    res.json({ ok: true, model: OLLAMA_MODEL, sample });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.toString() });
  }
});

// Generate a joke
app.post('/api/generate', async (req, res) => {
  const style = (req.body && req.body.style) ? req.body.style : 'one-liner';
  const topic = (req.body && req.body.topic) ? req.body.topic : '';
  const prompt = buildPrompt(style, topic);

  try {
    const out = await callOllama(prompt);
    const joke = (typeof out === 'string') ? out.trim() : JSON.stringify(out);
    res.json({ joke });
  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`joke-app listening on port ${PORT}`);
});
