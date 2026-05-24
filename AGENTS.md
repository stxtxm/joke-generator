# Notes pour les agents IA

Ce fichier documente l'architecture, les décisions clés et les pièges fréquents
pour qu'un agent IA comprenne rapidement le projet sans se perdre.

## Identité du projet

**Générateur de Blagues** — App web full-stack (Express + React) qui génère des
blagues en français via Gemini API (Google) ou Ollama (LLM local), avec un
système de notation, de feedback et d'optimisation de style humoristique.

## Stack technique

- **Backend** : Node.js + Express + better-sqlite3 (SQLite)
- **Frontend** : React 18 + React Router 6 + Vite
- **LLM** : Google Gemini API (gemini-2.5-flash-lite) ou Ollama (qwen2.5:1.5b local)
- **Base de données** : SQLite (`jokes.db`) avec système de migrations
- **Déploiement** : Docker multi-stage (node:22-bookworm-slim), docker-compose

## Architecture des dossiers

```
server.js              → Serveur Express (API + DB + LLM calls)
lib/
  migrations.js        → Migrations DB idempotentes
  models.js            → Découverte des modèles Ollama + Gemini
static/
  js/src/              → React SPA (App.js, Admin.js, components/)
  css/styles.css       → Thème sombre
tests/
  api/                 → Tests serveur (jest + supertest)
  components/          → Tests React (jest + testing-library)
scripts/               → Utilitaires (seed, build_dataset, training)
Dockerfile             → Multi-stage build
docker-compose.yml     → Services: ollama, app, train (profil)
```

## ⚠️ Pièges fréquents pour les agents

### 1. Le modèle par défaut est `gemini`, pas Ollama

```js
// server.js — ligne 56
let currentModel = 'gemini';
```

Ne pas changer — le projet utilise Gemini API par défaut.
Le panneau admin (`/admin`) permet de basculer entre les modèles sans
redémarrage via `POST /admin/set-model`.

### 2. Gemini API nécessite une clé API

L'app utilise `GEMINI_API_KEY` (ou `GOOGLE_API_KEY` en fallback) pour appeler
l'API REST Google Gemini. La variable est passée au conteneur Docker via
docker-compose.yml.

### 3. Fallback automatique vers Ollama

Si l'API Gemini échoue (quota épuisé, timeout, erreur réseau), le système
bascule automatiquement vers Ollama pour la requête en cours. Pas besoin
d'intervention manuelle.

### 4. La DB est un fichier SQLite persistant

`jokes.db` est créé automatiquement au démarrage. Le répertoire `/app/node_modules`
est monté comme un volume nommé vide (empêche l'écrasement par le dossier local).

### 5. Système de styles humoristiques (epsilon-greedy)

5 styles : `dark`, `absurd`, `observational`, `cynical`, `wordplay`.
Algorithme : 70% meilleur style (Laplace smoothing), 30% round-robin.
Performances tracées dans la table `prompt_styles`.

### 6. Validation des blagues

Une blague est valide si :
- Longueur 20-220 caractères
- Termine par `.`, `!`, `?`, `"` ou `…`
- Contient un "twist" (point d'interrogation + chute, ou mots-clés)

### 7. Deux prompts différents selon le modèle

- **`getGeminiPrompt()`** — prompt long et détaillé : tous les exemples validés,
  contre-exemples, thèmes récents, stats, style. Gemini peut encaisser un gros
  contexte.
- **`getOllamaPrompt()`** — prompt très court (< 200 car.) : 1 seul exemple,
  style. `num_predict: 40`, `top_p: 0.85`, `top_k: 40`, `num_ctx: 512` pour
  économiser les ressources.

### 8. Pas de `curated_examples`

La table `curated_examples` a été supprimée (migration `007`). Les exemples
pour le prompt sont directement tirés de la table `jokes` via les requêtes
`bestJokes` (likées) et `worstJokes` (dislikées). Si aucune blague n'est encore
notée, 4 fallbacks hardcodés sont utilisés.

### 9. Système de règles adaptatives (feedback loop)

L'app adapte dynamiquement le prompt Gemini selon les retours utilisateur :

- **`prompt_rules`** table : track les patterns de début de phrase (`start:pourquoi`,
  `starts_with:j_ai`), le format (`has_question`), la longueur (`length:medium`)
- **`getAdaptiveRules()`** : retourne les patterns à éviter (like_rate < 0.4)
  et à privilégier (like_rate >= 0.6), filtrés sur min 4 évaluations et 6 total
- **`updatePromptRules(joke, isLike)`** : appelé après chaque vote dans `/api/rate`
- Les règles sont injectées dynamiquement dans `getGeminiPrompt()` sous forme
  de sections `ÉVITE ABSOLUMENT` / `PRIVILÉGIE`
- Le bouton "Reset Prompt Rules" dans le panneau admin vide la table `prompt_rules`

Le prompt Gemini interdit aussi explicitement les débuts par "J'ai", "C'est",
"Un/Une", "Il/Elle" et demande une variation obligatoire des structures.

## Flux de génération

1. `POST /api/generate`
2. Récupère meilleures/pires/dernières blagues de la DB (ou fallbacks si vide)
3. Sélectionne un style humoristique
4. Construit un prompt adapté au modèle (getGeminiPrompt ou getOllamaPrompt)
5. Appelle le LLM (callGemini ou callOllama selon currentModel)
6. Si Gemini échoue, fallback vers Ollama pour la requête
7. Nettoie la réponse (supprime introductions, labels)
8. Valide (longueur, ponctuation, twist, similarité n-gram)
9. Insère en DB + feedback + style log
10. Retourne `{ joke, style }`

## Base de données (SQLite)

Tables : `jokes`, `feedback`, `prompt_styles`,
`style_log`, `migrations`

Migrations idempotentes dans `lib/migrations.js` (8 migrations, de `001` à `008`).

## Endpoints API clés

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/generate` | POST | Génère une blague |
| `/api/rate` | POST | Note une blague (1/-1/0) |
| `/api/joke/metrics` | GET | Stats d'une blague |
| `/admin/models` | GET | Liste les modèles disponibles |
| `/admin/set-model` | POST | Change le modèle actif |
| `/admin/reset-db` | POST | Réinitialise la base |
| `/admin/reset-rules` | POST | Réinitialise les règles adaptatives |

## Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3000` | Port du serveur HTTP |
| `GEMINI_API_KEY` | — | Clé API Google Gemini |
| `GOOGLE_API_KEY` | — | Fallback si GEMINI_API_KEY non défini |
| `OLLAMA_HOST` | `http://ollama:11434` | Hôte Ollama (interne Docker) |
| `OLLAMA_MODEL` | `qwen2.5:1.5b` | Modèle Ollama par défaut |

## Tests

```bash
npm test
```

Tests API (jest + supertest) dans `tests/api/`.
Tests composants React (jest + testing-library) dans `tests/components/`.

## Commandes Docker utiles

```bash
# Rebuild + démarrage
docker compose up -d --build

# Logs
docker compose logs -f app
```
