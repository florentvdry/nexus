# NEXUS

[![CI](https://github.com/florentvdry/nexus/actions/workflows/ci.yml/badge.svg)](https://github.com/florentvdry/nexus/actions/workflows/ci.yml)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

**NEXUS** est un assistant personnel pour Windows, open source, inspiré des interfaces de type JARVIS.
Vous formulez une intention, NEXUS choisit les outils. Les commandes courantes s'exécutent en local, sans modèle de
langage, sans compte et sans abonnement.

> **Statut** : phases 1, 3 et 4 livrées, phase 5 commencée (journal des commandes, plugins). La reconnaissance vocale est
> implémentée mais attend le modèle Whisper. Le détail et les limites sont dans [docs/PLAN.md](docs/PLAN.md).
> Le contrôle des fenêtres Windows est implémenté, mais n'a pas encore été vérifié sur Windows.

## Ce que fait NEXUS

| Domaine | Exemples de demandes | Remarques |
| --- | --- | --- |
| Applications | « Lance le Bloc-notes », « Ouvre Discord », « Open Google Chrome » | Seules les applications du catalogue sont lançables : Bloc-notes, Calculatrice, Paint, Explorateur, Chrome, Discord. |
| Système | « Affiche les informations de mon ordinateur », « Affiche l'utilisation CPU » | Processeur, mémoire, disques, durée de fonctionnement, réels. |
| Fenêtres | « Liste mes fenêtres », « passe sur la fenêtre Word », « ferme la fenêtre Discord » | Windows uniquement. Chaque action demande votre accord. |
| Fichiers | « Cherche mes fichiers PDF téléchargés cette semaine », « Renomme a.pdf en b.pdf » | Recherche dans Documents, Téléchargements, Bureau et Images. Renommer, déplacer, copier et supprimer demandent votre accord ; la suppression passe par la corbeille. |
| Processus | « Quelles applications sont ouvertes ? » | Lecture seule, triée par mémoire utilisée. |
| OSINT | « Analyse example.com », « Recherche le pseudo alice », « Analyse le fichier C:\\Users\\Ana\\contrat.pdf » | Sources publiques. Chaque résultat indique sa source, sa référence et son statut. Une correspondance n'est pas une identité. |
| Claude Code | « Lance Claude Code dans C:\\Dev\\projet : corrige le test en échec » | Lance le CLI officiel `claude` dans ce dossier, après votre accord. Le CLI doit être installé et connecté. |
| Plugins | « installe le plugin <dossier ou adresse HTTPS> », « liste mes plugins » | Plugins de données (vocabulaire, sans code) et plugins WebAssembly (bac à sable). Chaque installation demande deux confirmations. |

Les commandes se formulent en français ou en anglais, et NEXUS retient ce dont on parle : après « cherche mes fichiers txt »,
« renomme le deuxième en idees.txt » fonctionne. Quand une demande est ambiguë, NEXUS demande lequel. Une action
destructive passe toujours par une confirmation, y compris après une référence.

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
- Réponses lues à voix haute avec les voix installées sur Windows. Langue automatique, ou français ou anglais imposé.
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

## Confidentialité

- Aucune donnée n'est envoyée à un service externe pour les commandes locales. Les recherches OSINT interrogent les
  sources publiques que leur résultat cite.
- Aucun micro n'est utilisé sans que vous l'activiez.
- Aucune élévation de privilèges n'est demandée.
- Le détail de ce qui est confirmé, et de ce qui ne l'est pas : [docs/PERMISSIONS.md](docs/PERMISSIONS.md).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) : structure du code et flux de données.
- [docs/PERMISSIONS.md](docs/PERMISSIONS.md) : permissions, confirmations, autorisations mémorisées.
- [docs/DECISIONS.md](docs/DECISIONS.md) : décisions d'architecture (ADR).
- [docs/PLAN.md](docs/PLAN.md) : état des phases et limites connues.

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md). Signaler une vulnérabilité : voir [SECURITY.md](SECURITY.md).

## Licence

MIT. Voir [LICENSE](LICENSE).
