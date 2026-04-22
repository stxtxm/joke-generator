# Générateur de Blagues

Application web qui génère des blagues aléatoires en français en utilisant Ollama (LLM local) avec un frontend React moderne.

## Prérequis

- Docker
- Docker Compose
- Node.js 18+ (développement local)
- Ollama (inclus dans Docker)

## Démarrage rapide

```bash
# Lancer tous les services
docker-compose up -d
```

Cela démarre :
- **Ollama** sur http://localhost:11434
- **Application** sur https://localhost:3000

## Développement local

```bash
# Installer les dépendances
npm install

# Mode développement (avec hot reload)
npm run dev

# Build de production
npm run build

# Prévisualiser le build
npm run preview

# Démarrer le serveur en production (après build)
npm start
```

## Configuration

Variables d'environnement (optionnel) dans `.env` :

```env
OLLAMA_HOST=http://ollama:11434
OLLAMA_MODEL=gemma2:2b
EXPORT_INTERVAL_MIN=60
```

## Architecture

```
static/js/
├── main.js              # Point d'entrée React
└── src/
    ├── App.js          # Routeur principal
    ├── Admin.js       # Page d'administration
    ├── components/    # Composants UI
    └── lib/api.js    # Client API

dist/                  # Build de production (généré par Vite)
```

## Architecture Docker

Multi-stage build :
- **Builder** : installe les dépendances et build le frontend React
- **Prod** : image légère qui sert les assets statiques et l'API

## Interface

- **App** : http://localhost:3000/
- **Admin** : http://localhost:3000/admin

## API Endpoints

### Génération de blagues

```bash
# Générer une blague
curl -X POST https://localhost:3000/api/generate
```

### Feedback

```bash
# Noter une blague (1 = like, -1 = dislike)
curl -X POST https://localhost:3000/api/rate \
  -H "Content-Type: application/json" \
  -d '{"joke": "Ma blague", "rating": 1}'
```

### Administration

```bash
# Lister les exemples curatés
curl https://localhost:3000/admin/curated

# Ajouter un exemple
curl -X POST https://localhost:3000/admin/curated \
  -H "Content-Type: application/json" \
  -d '{"content": "Ma blague", "approved": 1, "notes": "funny"}'

# Supprimer un exemple
curl -X DELETE https://localhost:3000/admin/curated/1

# Déclencher un export
curl https://localhost:3000/admin/trigger-export

# Lister les exports
curl https://localhost:3000/admin/exports-list

# Statut entraînement
curl https://localhost:3000/admin/train-status
```

## Commandes Docker utiles

```bash
# Builds & démarrage
docker-compose build --no-cache app
docker-compose up -d

# Logs
docker-compose logs -f app

# Redémarrer
docker-compose restart app

# Arrêter
docker-compose down
```

## Notes

- Les endpoints `/admin/*` ne sont pas protégés. À sécuriser enproduction.
- Le modèle par défaut est `gemma2:2b`. Configurable via `OLLAMA_MODEL`.
- Exports écrits dans `exports/` toutes les 60 min (désactivable avec `EXPORT_INTERVAL_MIN=0`).