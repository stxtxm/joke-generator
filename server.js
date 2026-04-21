const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

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

function getNewJoke() {
  const theme = getRandomTheme();
  const used = getUsedJokes();
  const prompt = `UNE blague drole en francais uniquement. Question? Reponse. Theme: ${theme}`;
  
  try {
    const output = execSync('opencode run ' + JSON.stringify(prompt) + ' --model opencode/nemotron-3-super-free', {
      encoding: 'utf8',
      timeout: 45000,
      maxBuffer: 1024 * 50
    });
    
    let cleaned = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/^>.*$/m, '').trim();
    const lines = cleaned.split('\n').filter(l => l.trim() && !l.includes('En esperant'));
    
    let joke = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length > 10 && !line.includes('?')) {
        joke = line;
        break;
      }
    }
    if (!joke && lines.length > 0) joke = lines[lines.length - 1];
    if (!joke || joke.length < 15) joke = lines.join(' ').substring(0, 150);
    joke = joke.replace(/^[\s>\-]*/, '').replace(/"/g, '').trim();
    return joke.substring(0, 180);
  } catch(e) {
    console.error('Error:', e.message);
    return 'Erreur generation';
  }
}

function getJoke() {
  let joke = '';
  let attempts = 0;
  
  while (attempts < 3) {
    joke = getNewJoke();
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

const requestHandler = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  
  if (url.pathname === '/joke' && req.method === 'GET') {
    const joke = getJoke();
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
  console.log(`OUVERT`);
});

process.on('SIGTERM', () => {
  db.close();
  httpsServer.close();
  process.exit(0);
});