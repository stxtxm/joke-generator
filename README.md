# Générateur de Blagues

Application web full-stack qui génère des blagues humoristiques en français via
Gemini API (Google) ou Ollama (LLM local), avec système de notation,
curation automatique et optimisation de style humoristique.

## Fonctionnalités

- **Génération via Gemini API** (par défaut) : utilise Google Gemini 2.5 Flash Lite
- **Support Ollama** : bascule vers des modèles LLM locaux (qwen, llama, etc.)
- **Fallback automatique** : si Gemini est indisponible, bascule sur Ollama
- **5 styles humoristiques** : humour noir, absurde, observational, cynique, jeux de mots
- **Optimisation epsilon-greedy** : sélection adaptative du meilleur style
- **Curation automatique** : les blagues populaires deviennent des exemples pour le prompt
- **Panneau admin** : changement de modèle, gestion des exemples, stats

## Démarrage rapide

```bash
# Lancer les services
docker compose up -d --build
```

Accès :
- **App** : http://localhost:3000
- **Admin** : http://localhost:3000/admin

## Développement local

```bash
npm install
npm run dev       # Vite dev server (port 5173, proxy vers :3000)
npm run build     # Build production
npm test          # Tests (jest)
npm start         # Serveur Express seul
```

## Architecture

```
server.js              → Express (API, DB, LLM)
lib/migrations.js      → Migrations SQLite
lib/models.js          → Découverte de modèles
static/js/src/         → React SPA
  App.js               → Routeur, état, génération
  Admin.js             → Panneau d'administration
  components/          → JokeCard, Controls, IconButton
  lib/api.js           → Client API
```

## API

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/generate` | POST | Génère une blague |
| `/api/rate` | POST | Note une blague (1/-1/0) |
| `/api/joke/metrics` | GET | Stats d'une blague |
| `/admin/models` | GET | Modèles disponibles |
| `/admin/set-model` | POST | Change le modèle actif |

## Docker

```bash
docker compose up -d --build     # Rebuild + démarrage
docker compose logs -f app       # Logs
docker compose down              # Arrêt
```

## Environnement

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3000` | Port serveur |
| `GEMINI_API_KEY` | — | Clé Google Gemini |
| `OLLAMA_HOST` | `http://ollama:11434` | Hôte Ollama |
| `OLLAMA_MODEL` | `qwen:1.8b` | Modèle Ollama local |
