# Générateur de Blagues

Application web qui génère des blagues aléatoires en français en utilisant Ollama (LLM local).

## Prérequis

- Docker
- Docker Compose

## Configuration

Modifier `.env` pour configurer l'IP Tailscale (optionnel):

```env
TAILSCALE_IP=100.x.x.x
```

## Démarrage

```bash
docker-compose up -d
```

Cela démarrera:
- **Ollama** sur http://localhost:11434
- **Application** sur https://localhost:3000

## Premier démarrage

Le modèle le plus léger (`tinyllama`) sera téléchargé automatiquement au premier lancement.

Pour vérifier le statut:
```bash
docker logs joke-ollama
docker logs joke-app
```

## Tester

```bash
curl https://localhost:3000/joke
```

## Commandes utiles

```bash
docker-compose logs -f        # Voir les logs
docker-compose restart        # Redémarrer
docker-compose down           # Arrêter
```