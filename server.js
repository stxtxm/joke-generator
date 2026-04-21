const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://ollama:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'tinyllama';

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const db = new Database('jokes.db');
try {
  db.exec(`CREATE TABLE IF NOT EXISTS jokes (id INTEGER PRIMARY KEY, text TEXT, rating INTEGER DEFAULT 0, used_at DATETIME)`);
} catch(e) {}

const themeList = ['tech', 'dev', 'animal', 'medecin', 'chef', 'ecole', 'travail', 'famille', 'voyage', 'sport'];

function getRandomTheme() {
  return themeList[Math.floor(Math.random() * themeList.length)];
}

function getUsedJokes() {
  try {
    const rows = db.prepare('SELECT text FROM jokes ORDER BY used_at DESC LIMIT 3').all();
    return rows.map(r => (r.text || '').substring(0, 30)).join(', ');
  } catch(e) { return ''; }
}

function httpRequest(url, method, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });
    
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function getNewJoke() {
  const theme = getRandomTheme();
  const prompt = `Raconte une blague française drole et courte. 
格式: "Pourquoi [question]? [réponse]"
La blague doit être COMPLETE sans coupure.
Topic: ${theme}

Exemples:
Pourquoi les développeurs sont-ils mauvais en amour? Parce qu'ils parlent en JavaScript!
Pourquoi le developer a mangé sa pizza? Car il aimait le code!`;
  
  try {
    const response = await httpRequest(`${OLLAMA_HOST}/api/generate`, 'POST', {
      model: OLLAMA_MODEL,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.9,
        top_p: 0.95,
        num_predict: 150,
        stop: []
      }
    });
    
    const data = JSON.parse(response);
    let joke = data.response || '';
    
    joke = joke.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    joke = joke.replace(/^[>\s\-:]*/, '').replace(/"/g, '').replace(/\n/g, ' ');
    
    joke = joke.replace(/^(voici|alors|voila|réponse|question|bien|Voilà)\s*[:\-]*/i, '');
    
    if (joke.length > 200) joke = joke.substring(0, 200);
    
    let lastPunct = Math.max(joke.lastIndexOf('!'), joke.lastIndexOf('.'));
    if (lastPunct > joke.length * 0.7) {
      joke = joke.substring(0, lastPunct + 1);
    }
    
    return joke.trim();
  } catch(e) {
    console.error('Error:', e.message);
    return 'Erreur generation';
  }
}

async function getJoke() {
  let joke = '';
  let attempts = 0;
  
  while (attempts < 3) {
    joke = await getNewJoke();
    if (joke && joke.length > 15 && !joke.includes('Erreur')) {
      try {
        const exists = db.prepare('SELECT id FROM jokes WHERE text = ?').get(joke);
        if (!exists) {
          const info = db.prepare('INSERT INTO jokes (text, rating, used_at) VALUES (?, 0, datetime("now"))').run(joke);
          return { text: joke, id: info.lastInsertRowid };
        }
      } catch(e) {}
    }
    attempts++;
  }
  return { text: joke || 'Pas de blague', id: 0 };
}

const requestHandler = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  
  if (url.pathname === '/joke' && req.method === 'GET') {
    const joke = await getJoke();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ joke: joke.text, id: joke.id }));
  } else if (url.pathname === '/feedback' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { joke_id, rating } = JSON.parse(body);
        if (rating === 1 || rating === -1) {
          db.prepare('UPDATE jokes SET rating = rating + ? WHERE id = ?').run(rating, joke_id);
        }
      } catch(e) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
  }
};

const httpsServer = https.createServer({
  key: fs.readFileSync('/tmp/key.pem'),
  cert: fs.readFileSync('/tmp/cert.pem')
}, requestHandler);

const tsIP = process.env.TAILSCALE_IP || 'localhost';

httpsServer.listen(PORT, HOST, () => {
  console.log(`HTTPS: https://${tsIP}:${PORT}`);
  console.log(`Ollama: ${OLLAMA_HOST}`);
  console.log(`Model: ${OLLAMA_MODEL}`);
  console.log(`OUVERT`);
});

process.on('SIGTERM', () => {
  db.close();
  httpsServer.close();
  process.exit(0);
});