# Plan : Basculement Dynamique des Modèles

## Objectif
Permettre de choisir entre les modèles Gemini et Ollama via le panel admin sans redémarrer le serveur ni reconstruire l'application.

## Étapes
1.  **Révision de `server.js` :**
    - S'assurer que `GENERATION_MODE` et `currentModel` sont bien mis à jour en mémoire par `/admin/set-model`.
    - Vérifier la logique de `callOllama` et `callGemini` pour s'assurer qu'elles utilisent les variables globales mises à jour.
2.  **Amélioration de `/admin/set-model` :**
    - Ajouter une logique pour détecter si le modèle sélectionné appartient à Gemini ou Ollama.
3.  **Validation :**
    - Vérifier que les variables `GENERATION_MODE` et `currentModel` sont bien mises à jour instantanément.
