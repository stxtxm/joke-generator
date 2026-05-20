#!/usr/bin/env node
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'jokes.db'));

// Récupérer les bonnes blagues
const jokes = db.prepare(`
  SELECT content, likes, dislikes
  FROM jokes
  WHERE likes >= 3 AND dislikes = 0
  ORDER BY likes DESC
`).all();

console.log(`Jokes candidates: ${jokes.length}`);

function hasTwist(joke) {
  const lower = joke.toLowerCase();
  if (!lower.includes('?')) return false;
  const parts = joke.split('?');
  if (parts.length < 2) return false;
  const punchline = parts.slice(1).join('?').trim();
  if (punchline.length < 10) return false;

  const contradictionWords = ['mais', 'pourtant', 'cependant', 'alors que', 'sauf que'];
  if (contradictionWords.some(w => punchline.toLowerCase().includes(w))) return true;

  const twistWords = ['parce qu', 'simplement parce', 'en fait', 'finalement'];
  if (twistWords.some(w => punchline.toLowerCase().includes(w))) return true;

  return punchline.length > 15;
}

function isDuplicate(content, existing) {
  for (const existingJoke of existing) {
    if (content === existingJoke) return true;
    if (content.length > 20 && existingJoke.includes(content.substring(0, 20))) return true;
    if (existingJoke.length > 20 && content.includes(existingJoke.substring(0, 20))) return true;
  }
  return false;
}

const dataset = [];
const seen = [];

for (const joke of jokes) {
  if (joke.content.length < 20 || joke.content.length > 180) continue;
  if (!hasTwist(joke.content)) continue;
  if (isDuplicate(joke.content, seen)) continue;

  dataset.push({
    instruction: "Raconte une blague courte",
    output: joke.content
  });
  seen.push(joke.content);

  if (dataset.length >= 100) break;
}

const outputPath = path.join(__dirname, '..', 'dataset.jsonl');
const lines = dataset.map(item => JSON.stringify(item)).join('\n');
fs.writeFileSync(outputPath, lines + '\n');

console.log(`Dataset créé: ${dataset.length} blagues -> ${outputPath}`);
db.close();
