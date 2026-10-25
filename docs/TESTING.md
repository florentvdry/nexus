# Tests de bout en bout

Ce document décrit comment l'application est testée sur l'application de bureau réelle, avec un modèle réel. Les résultats
et les captures sont dans le [README](../README.md#tests-de-bout-en-bout) et dans [docs/screenshots/](screenshots/).

## Ce qui tourne

- **Application** : `pnpm tauri dev` (la même interface et le même natif que l'installateur).
- **Pilotage** : le débogage distant de WebView2 (protocole Chrome DevTools) sur le port 9222. Le script `e2e/run.mjs`
  saisit les demandes comme un utilisateur (saisie puis Entrée), attend les réponses, clique sur les boutons, et prend les
  captures. Aucune dépendance : Node 22 ou plus.
- **Modèle** : Ollama sur ce poste. Le premier lancement choisit `qwen2.5:7b` ; `qwen2.5vl` sert à la lecture d'écran.
- **Réseau** : les sources publiques (Wikipédia, Wikimedia Commons, Google Actualités, DuckDuckGo, RDAP) sont
  interrogées réellement. NVIDIA NIM n'est pas activé : aucune donnée ne part vers NVIDIA.

## Lancer

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" pnpm tauri dev
node e2e/run.mjs              # tous les parcours
node e2e/run.mjs settings     # un parcours seul : setup, conversation, system, applications, files, agenda,
                              # memory, schedule, web, screen, osint, connectors, plugins, settings
```

Le rapport est écrit dans `e2e/results.json`. Les captures vont dans `docs/screenshots/`.

## Données touchées

Le script modifie les données réelles de l'application (souvenirs, journal, préférences, agenda désigné, planning). Il
faut donc sauvegarder avant, et restaurer après :

- `%APPDATA%\fr.nexus.assistant` (souvenirs, journal, voix) ;
- `%LOCALAPPDATA%\fr.nexus.assistant` (profil WebView2, donc préférences de l'interface).

Le script crée et supprime des fichiers de test dans `Documents` (`nexus-e2e-*.txt`). Il ouvre le Bloc-notes et le
referme après accord. Il déclenche des demandes de confirmation et répond à certaines d'entre elles : la suppression
est refusée, l'envoi à la corbeille n'est pas utilisé sur les fichiers de l'utilisateur.

## Ce qui n'est pas testé ici, et pourquoi

- **Micro.** La reconnaissance sur un vrai micro n'a pas été testée. La synthèse et la reconnaissance le sont sur des fichiers (aller-retour Kokoro vers Whisper, ADR-058). La lecture à voix
  haute n'est pas vérifiable sans écouter.
- **NVIDIA NIM.** Aucune clé n'est configurée : le test ne peut pas envoyer de données à un service en ligne.
- **Connecteurs MCP réels (Discord).** Le test s'arrête à la proposition : il faudrait un jeton de bot Discord.
- **Claude Code.** Le CLI `claude` n'est pas sur ce poste ; le test vérifie le message « non installé ».
- **Mises à jour, installateur, démarrage avec Windows.** Hors périmètre du parcours.
