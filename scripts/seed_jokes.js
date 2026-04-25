#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'jokes.db'));

const jokes = [
  "Pourquoi les gens veulent réussir ?\nParce qu'ils pensent que ça va réparer autre chose.",
  "Pourquoi les gens travaillent dur ?\nPour éviter de réfléchir.",
  "Pourquoi les gens disent 'ça va' ?\nParce que personne ne veut la vraie réponse.",
  "Pourquoi les gens aiment les réseaux sociaux ?\nParce que juger est plus simple que comprendre.",
  "Pourquoi les gens veulent être heureux ?\nParce qu'ils n'ont jamais essayé d'être honnêtes.",
  "Pourquoi les gens ont peur d'échouer ?\nParce que réussir demande plus d'efforts ensuite.",
  "Pourquoi les gens veulent changer ?\nParce que rester pareil devient trop évident.",
  "Pourquoi les gens aiment le week-end ?\nParce que leur vie ne leur plaît pas.",
  "Pourquoi les gens aiment les vacances ?\nParce qu'ils fuient leur quotidien.",
  "Pourquoi les gens font semblant ?\nParce que la vérité coûte trop cher."
];

for (const content of jokes) {
  try {
    db.prepare('INSERT OR IGNORE INTO jokes (content, category, likes, dislikes, rating, length) VALUES (?, ?, ?, ?, ?, ?)')
      .run(content, 'joke', 3, 0, 3, content.length);
    console.log('Added: ' + content.substring(0, 50) + '...');
  } catch(e) {}
}
console.log('Done!');
db.close();
