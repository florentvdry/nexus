# NEXUS

[![CI](https://github.com/florentvdry/nexus/actions/workflows/ci.yml/badge.svg)](https://github.com/florentvdry/nexus/actions/workflows/ci.yml)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

**NEXUS** est un assistant personnel pour Windows, open source, inspiré des interfaces de type JARVIS.
Vous formulez une intention, NEXUS choisit les outils. Les demandes sont comprises par un modèle de langage qui tourne
sur votre PC (Ollama). Sans compte et sans abonnement. Un service en ligne n'est utilisé que si vous l'activez.

> **Statut** : les phases 1, 3 et 4 sont livrées (validation sous Windows en cours), la phase 2 est partielle et la phase 5
> est en cours. La reconnaissance vocale attend le modèle Whisper, et le contrôle des fenêtres Windows n'a pas encore été
> vérifié sur Windows. Le détail et les limites sont dans [docs/PLAN.md](docs/PLAN.md) et [docs/TODO.md](docs/TODO.md).

## Ce que fait NEXUS

| Domaine | Exemples de demandes | Remarques |
| --- | --- | --- |
| Applications | « Lance le Bloc-notes », « Ouvre Discord », « Open Google Chrome » | Toute application trouvée sur ce PC par son nom (menu Démarrer, registre, dossiers des programmes). Aucune liste fixe. |
| Système | « Affiche les informations de mon ordinateur », « Affiche l'utilisation CPU » | Processeur, mémoire, disques, durée de fonctionnement, réels. |
| Alertes | Automatiques | Disque presque plein, mémoire saturée, batterie faible non branchée. Une alerte par événement. |
| Fenêtres | « Liste mes fenêtres », « passe sur la fenêtre Word », « ferme la fenêtre Discord » | Windows uniquement. Chaque action demande votre accord. |
| Fichiers | « Cherche mes fichiers PDF téléchargés cette semaine », « Renomme a.pdf en b.pdf » | Recherche dans Documents, Téléchargements, Bureau et Images. Renommer, déplacer, copier et supprimer demandent votre accord ; la suppression passe par la corbeille. |
| Processus | « Quelles applications sont ouvertes ? » | Lecture seule, triée par mémoire utilisée. |
| Agenda et messages | « Qu'est-ce que j'ai aujourd'hui ? », « écris à Alice que je suis en retard » | L'agenda se lit depuis un fichier .ics que vous désignez, en lecture seule. Un message n'est qu'un brouillon à copier : NEXUS n'envoie rien. |
| Écran | « Qu'est-ce qui est affiché à l'écran ? » | Une seule capture, après votre « oui », lue par un modèle de vision local. Rien n'est enregistré sur le disque. |
| Questions et actualités | « Qui est Ada Lovelace ? », « Montre une photo de la tour Eiffel », « Quelles sont les actus ? », « Actus sur le climat » | Sources publiques : recherche web sans clé, Wikipédia, Wikimedia Commons, Google Actualités. Chaque réponse cite ses sources. |
| Tâches programmées | « Rappelle-moi demain à 9 h », « Chaque lundi, résume mes actus » | Exécutées pendant que NEXUS est ouvert. Liste et annulation dans le panneau Planning. |
| OSINT | « Analyse example.com », « Recherche le pseudo alice », « Analyse le fichier C:\\Users\\Ana\\contrat.pdf » | Sources publiques. Chaque résultat indique sa source, sa référence et son statut. Une correspondance n'est pas une identité. |
| Claude Code | « Lance Claude Code dans C:\\Dev\\projet : corrige le test en échec » | Lance le CLI officiel `claude` dans ce dossier, après votre accord. Le CLI doit être installé et connecté. |
| Connecteurs | « Envoie un message Discord » | Serveurs MCP du registre officiel, seulement s'ils ont au moins 50 étoiles sur GitHub, installés après votre accord. Node.js est requis. |
| Plugins | « installe le plugin <dossier ou adresse HTTPS> », « liste mes plugins » | Plugins de données (vocabulaire, sans code) et plugins WebAssembly (bac à sable). Chaque installation demande deux confirmations. |

Les commandes se formulent en français ou en anglais, et NEXUS retient ce dont on parle : après « cherche mes fichiers txt »,
« renomme le deuxième en idees.txt » fonctionne. Quand une demande est ambiguë, NEXUS demande lequel. Une action
destructive passe toujours par une confirmation, y compris après une référence.

## Modèle de langage local

- Chaque demande est comprise par un modèle qui tourne sur ce PC, via Ollama (adresse `127.0.0.1` seulement).
  Au premier lancement, NEXUS propose d'installer Ollama et un modèle, après votre accord. Le modèle dépend de la machine
  (Qwen2.5 1,5 B, 7 B ou 14 B, de 1 à 9 Go) et reste modifiable dans les réglages.
- Sa réponse est contrainte par un schéma et validée avant usage. Elle n'est jamais exécutée telle quelle.
- Sans modèle prêt, NEXUS le signale et ne devine rien.
- **NVIDIA NIM (option, désactivé par défaut)** : avec votre clé, les demandes sont envoyées à NVIDIA. Sans clé, ou en cas
  d'échec, le modèle local répond.
- **Mémoire** : le modèle retient les informations durables que vous donnez (prénom, préférences). « Oublie X » les efface,
  et la liste se consulte dans les réglages. La conversation elle-même n'est pas conservée au redémarrage.

## Autorisations mémorisées

Pour les actions répétitives, la case **« Toujours autoriser »** de la carte de confirmation évite de répondre à chaque fois :

- écriture de fichiers dans un dossier donné (sous-dossiers compris) ;
- lancement de Claude Code pour un projet donné.

Elle n'est jamais proposée pour la suppression, la fermeture de fenêtre ni les plugins. Chaque approbation automatique est
annoncée dans la conversation, journalisée, et chaque règle se révoque dans les réglages. Détails dans
[docs/PERMISSIONS.md](docs/PERMISSIONS.md).

## Voix

- Clic sur le bouton micro, ou raccourci global `Ctrl+Alt+Espace`. La saisie texte reste disponible.
- Reconnaissance hors ligne avec whisper.cpp et Silero VAD : aucun audio n'est envoyé à un service externe.
- Lecture à voix haute avec une voix neurale locale (Piper). La voix française s'installe depuis les réglages vocaux, sur
  votre clic. Sans cette voix, ou pour l'anglais, la voix installée sur Windows lit la réponse.
- Langue automatique, ou français ou anglais imposé.
- Réponses à voix haute : jamais, après une commande vocale (par défaut), ou toujours.

**Modèle de reconnaissance** : il n'est pas inclus dans NEXUS. Téléchargez `ggml-base.bin` (multilingue, environ 148 Mo)
depuis le dépôt officiel de whisper.cpp, puis placez-le à l'emplacement affiché dans les réglages vocaux :

- Windows : `%APPDATA%\fr.nexus.assistant\models\ggml-base.bin`
- Autre : valeur de la variable d'environnement `NEXUS_WHISPER_MODEL`, si elle est définie.

## Plugins

- **Plugins de données** : « installe le plugin … » examine le plugin, puis l'installe après deux confirmations. Un plugin
  de données ajoute du vocabulaire et des noms d'applications ; il ne contient aucun code.
  Spécification : [docs/PLUGIN-SPEC.md](docs/PLUGIN-SPEC.md). Exemple : `examples/plugins/community.exemple.verbes`.
- **Plugins WebAssembly** : écrits en Rust (SDK `sdk/nexus-plugin-sdk`), ils ne s'exécutent que dans un bac à sable. Ils ne
  reçoivent que le stockage et le réseau déclarés dans leur manifeste, approuvés à l'installation.
  Exemple : `examples/plugins/community.exemple.convertisseur` (« convertis 12 km en miles », « retiens … », « rappelle »).

## Journal des commandes

Désactivé par défaut. Activé dans les réglages, il garde le texte de vos commandes (500 au plus), jamais les résultats ni le
contenu des fichiers. Effaçable à tout moment. Voir [docs/PERMISSIONS.md](docs/PERMISSIONS.md) pour le détail.

## Installation

NEXUS n'a pas encore d'installateur public. Pour le lancer depuis le code source, suivez le guide de développement :
[CONTRIBUTING.md](CONTRIBUTING.md#mise-en-place).

En résumé : Node.js 22, pnpm 10, Rust 1.97 ou plus récent, et sous Windows les Outils de build Visual Studio (charge C++)
et WebView2 (présent sur Windows 11).

```bash
pnpm install
pnpm tauri dev
```

Au premier lancement, NEXUS installe Ollama et le modèle de langage après votre accord. Le téléchargement peut peser
plusieurs Go.

## Confidentialité

- Les demandes sont comprises par le modèle local, sur ce PC. Elles ne partent vers NVIDIA que si vous activez l'option NIM
  et fournissez une clé.
- Les questions ouvertes et les actualités interrogent des sources publiques (recherche web sans clé, Wikipédia,
  Wikimedia Commons, Google Actualités) : seuls les termes de la recherche sont envoyés, et jusqu'à trois pages de
  résultats sont lues, sans compte.
- Les recherches OSINT interrogent les sources publiques que leur résultat cite.
- Aucune capture d'écran sans votre « oui », et aucune capture n'est enregistrée.
- Les voix sont téléchargées une seule fois, après votre accord. La lecture se fait sur ce PC.
- Aucun micro n'est utilisé sans que vous l'activiez.
- Le démarrage avec Windows est une case des réglages. Rien n'est écrit à l'installation.
- Aucune élévation de privilèges n'est demandée.
- Le détail de ce qui est confirmé, et de ce qui ne l'est pas : [docs/PERMISSIONS.md](docs/PERMISSIONS.md).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) : structure du code et flux de données.
- [docs/PERMISSIONS.md](docs/PERMISSIONS.md) : permissions, confirmations, autorisations mémorisées.
- [docs/DECISIONS.md](docs/DECISIONS.md) : décisions d'architecture (ADR). Une décision remplacée le dit en tête.
- [docs/PLAN.md](docs/PLAN.md) : état des phases et limites connues.
- [docs/TODO.md](docs/TODO.md) : ce qui reste à faire et à vérifier.
- [docs/PLUGINS.md](docs/PLUGINS.md) et [docs/PLUGIN-SPEC.md](docs/PLUGIN-SPEC.md) : plugins et paquets de données.

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md). Signaler une vulnérabilité : voir [SECURITY.md](SECURITY.md).

## Licence

MIT. Voir [LICENSE](LICENSE).
