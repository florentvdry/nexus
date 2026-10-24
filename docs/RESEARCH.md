# Recherche : ce que font les assistants « Jarvis » et les IA personnelles

Relevé du 24/10/2026. Sources secondaires (blogs de comparaison, sites de projets) : à reprendre avec prudence. Les
chiffres d'usage viennent de populations différentes et d'années différentes ; ils donnent des tendances, pas des mesures.

## 1. Les projets « Jarvis » sur le marché

| Projet | Plateforme | Ce qu'il fait | Remarque |
|---|---|---|---|
| [amanimran786/jarvis-ai](https://github.com/amanimran786/jarvis-ai) | macOS | Écoute, parle, voit l'écran, mémorise, pilote des outils | Local d'abord |
| [PanPenek/JarvisAi](https://github.com/PanPenek/JarvisAi) | Windows | Mot de réveil, lecture de l'écran par OCR, 31 outils (bureau, applications, recherche web, fichiers, système), jusqu'à 15 appels d'outils par demande | Le plus proche de NEXUS |
| [alimaandev/Friday](https://www.producthunt.com/@ali_sher_dev) | Web et Python | Commande vocale, gestes de la main, tableau de bord temps réel, agenda et messagerie Google | Intégrations de comptes |
| [vierisid/jarvis](https://github.com/vierisid/jarvis) | Démon | Délégation multi-agents, constructeur de flux visuel, nombreux fournisseurs de modèles, Ollama compris | Proche de l'idée d'équipe |
| [MAL19 JARVIS OS V.2](https://github.com/MAL19INDUSTRIES/JARVIS-OS-V.2) | Multi | Automatisation et flux de travail, licence MIT | Peu documenté |
| Projets sur Claude Code | macOS | Couche vocale au-dessus de Claude Code | Usage personnel |

Constat : presque tous combinent **voix + réveil + contrôle du bureau + mémoire + outils**. Ce qui les différencie :
la clarté de la sécurité (confirmations) et la qualité de la mémoire. NEXUS a déjà les confirmations et la mémoire.

## 2. Assistants personnels ouverts : OpenClaw et Hermes

Source principale : [comparaison Parallel](https://parallel.ai/articles/openclaw-vs-nousresearch-hermes),
[documentation Hermes sur les tâches planifiées](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron).

- **Tâches planifiées** : les deux en ont. OpenClaw passe par une commande (`openclaw cron add`) et envoie par exemple
  un point du matin à 9 h. Hermes accepte une demande en langage naturel, avec des tâches ponctuelles ou récurrentes,
  et peut livrer le résultat dans la discussion d'origine ou dans un fichier.
- **Règle de sécurité notable (Hermes)** : une tâche planifiée ne peut pas en créer d'autres, pour éviter les boucles.
  À reprendre dans NEXUS.
- **Mémoire** : OpenClaw garde un fichier de mémoire et des journaux quotidiens. Hermes transforme un travail réussi
  en compétence réutilisable, sa principale particularité.
- **Accès partout** : les deux répondent depuis WhatsApp, Telegram, Slack ou Discord. NEXUS n'a pas ce canal ; à
  étudier plus tard, avec les mêmes garde-fous.

## 3. Usages constatés

- **Résumer et simplifier l'information** : tâche la plus citée, 38 % des adultes américains interrogés
  ([Hawkeye Poll, Université de l'Iowa, novembre 2025](https://politicalscience.uiowa.edu/node/1761)).
- **Planning et calendrier** : 55 % des petites entreprises automatisant pour réduire leurs coûts ([Website Builder
  Expert, via IT Brief](https://itbrief.news/story/us-small-firms-turn-to-ai-tools-to-cut-operating-costs)).
- **Délégation** : environ 30 % accepteraient qu'un assistant gère une partie de la planification du quotidien ; les
  achats et l'organisation viennent en tête, la finance seulement pour 20 %
  ([PYMNTS, via Let's Data Science](https://letsdatascience.com/news/consumers-embrace-autonomous-ai-assistants-selectively-768bc433)).
- **Calendrier** : le gain de temps le plus net, mais les chiffres viennent d'un éditeur
  ([guide des assistants de direction](https://stealthagents.com/research/ai-tools-used-by-executive-assistants)).

Lecture pour NEXUS : les demandes les plus utiles sont **résumer, rappeler, planifier, chercher une information**.
C'est exactement la logique « une demande = une fenêtre » et les tâches programmées.

## 4. Conséquences pour NEXUS

1. **Tâches programmées** (priorité) : « rappelle-moi demain à 9 h », « chaque lundi, résume mes actus ». Exécutées par
   le moteur existant, avec les mêmes confirmations. Une tâche planifiée ne peut pas en planifier d'autres.
2. **Fenêtres par demande** : résumé, photo, actualités, fiche. Résumer est le besoin le plus fréquent.
3. **Mémoire utile** : retenir les préférences et les routines, pas seulement des faits.
4. **Canal de messages plus tard** : seulement avec les mêmes confirmations et sans contournement du courtier.
5. **Pas de tableau de bord générique** : une fenêtre par besoin, pas une grille de widgets.

## 5. Ce que la recherche ne dit pas

- Pas d'enquête fiable sur l'usage des tâches planifiées par les assistants personnels : à compléter par une source
  éditeur ou une enquête type Pew.
- Les chiffres des projets Jarvis sont auto-déclarés. Aucun n'a été testé ici.
