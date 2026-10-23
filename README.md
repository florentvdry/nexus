# NEXUS

Assistant personnel intelligent pour Windows, open source, inspiré des interfaces de type JARVIS.
Vous formulez une intention ; NEXUS choisit les outils. Les commandes courantes s'exécutent en
local, sans modèle de langage et sans abonnement.

> **Statut : phases 1, 3 et 4 livrées, phase 5 commencée (journal des commandes), phase 2 partiellement livrée** (la transcription attend le modèle Whisper, et les
> résultats OSINT réels attendent l'accès aux sources publiques depuis l'environnement de développement).
> Le contrôle des fenêtres Windows est implémenté, mais n'a pas encore été exécuté sous Windows.
> Voir [docs/PLAN.md](docs/PLAN.md) pour le détail et les limites connues.

## Ce qui fonctionne aujourd'hui

- Interface sombre avec orbe centrale animée (sept états), zone des tâches, fenêtres flottantes.
- Commandes en français et en anglais, sans appel réseau :
  - « Lance le Bloc-notes », « Ouvre Discord », « Open Google Chrome »
  - « Affiche les informations de mon ordinateur », « Affiche l'utilisation CPU »
  - « Ferme cette fenêtre », « Ferme toutes les fenêtres », « Annule la recherche », « Aide »
- Applications lançables : Bloc-notes, Calculatrice, Paint, Explorateur de fichiers, Google Chrome, Discord.
  Seules ces applications peuvent être lancées.
- Informations système réelles : processeur, mémoire, disques, durée de fonctionnement.

## Voix (phase 2)

- Clic sur le bouton micro, ou raccourci global `Ctrl+Alt+Espace`. La saisie texte reste disponible.
- Reconnaissance hors ligne avec whisper.cpp et Silero VAD. Aucun audio n'est envoyé à un service externe.
- Réponses lues à voix haute avec les voix installées sur Windows (option dans les réglages vocaux).
- Langue : automatique (la réponse suit la langue de la commande), ou français / anglais imposé.
- Réponses à voix haute : jamais, après une commande vocale (par défaut), ou toujours. Réglable dans les réglages, et par le bouton haut-parleur de la barre de commande.

**Modèle de reconnaissance** : il n'est pas inclus dans NEXUS. Téléchargez `ggml-base.bin` (multilingue, environ 148 Mo)
depuis le dépôt officiel de whisper.cpp, puis placez-le à l'emplacement affiché dans les réglages vocaux :

- Windows : `%APPDATA%\fr.nexus.assistant\models\ggml-base.bin`
- Autre : valeur de la variable d'environnement `NEXUS_WHISPER_MODEL`, si elle est définie.

## Analyse OSINT (phase 3)

Exemples de demandes :

- « Analyse example.com » : adresses DNS et noms listés dans les journaux publics de certificats.
- « Recherche le pseudo alice » : présence sur GitHub, GitLab et Codeberg. Une correspondance n'est pas une identité.
- « Analyse le fichier C:\\Users\\Ana\\contrat.pdf » : empreinte SHA-256, type et statistiques, en local.

Chaque résultat indique sa source, sa référence et son statut. Une source injoignable est signalée, jamais masquée.
Les adresses email ne sont pas encore prises en charge.

## Fichiers, processus et Claude Code (phase 4)

- « Cherche mes fichiers PDF téléchargés cette semaine » : recherche dans Documents, Téléchargements, Bureau et Images
  uniquement. Le dossier personnel lui-même n'est jamais parcouru.
- « Renomme C:\Users\Ana\Documents\a.pdf en b.pdf », « déplace … dans … », « supprime … » : chaque opération affiche
  l'aperçu (source, destination) et attend votre autorisation. La suppression envoie à la corbeille.
- « Quelles applications sont ouvertes ? » : processus actifs, triés par mémoire utilisée (lecture seule).
- « Liste mes fenêtres », « passe sur la fenêtre Word », « ferme la fenêtre Discord » (Windows uniquement) : chaque action
  active ou ferme une fenêtre après votre accord. L'application peut refuser la fermeture ou demander d'enregistrer.
- « Lance Claude Code dans C:\Dev\projet : corrige le test en échec » : après votre autorisation, lance le CLI officiel
  `claude` dans ce dossier et affiche sa réponse, les outils utilisés et les refus de permission. Une annulation est possible
  pendant le run. Le CLI doit être installé et connecté (`npm install -g @anthropic-ai/claude-code`).

Les commandes sont conservées dans un journal local seulement si vous l'activez dans les réglages (désactivé par défaut,
effaçable à tout moment). Voir [docs/PERMISSIONS.md](docs/PERMISSIONS.md) pour ce qui est confirmé, et ce qui ne l'est pas.

## Installation pour le développement

Prérequis :

- Node.js 22 et pnpm 10
- Rust stable (1.77.2 ou plus récent)
- Sous Windows : Microsoft Edge WebView2 (présent sur Windows 11), et Visual Studio Build Tools (charge C++) avec CMake et LLVM/Clang, pour compiler whisper.cpp
- Sous Linux (pour compiler seulement) : `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libssl-dev libxdo-dev libasound2-dev cmake clang`

```bash
pnpm install
pnpm tauri dev          # application de bureau en développement
pnpm test               # tests frontend (Vitest)
pnpm typecheck          # TypeScript strict
cd src-tauri && cargo test                          # tests Rust
cd src-tauri && cargo test -- --ignored            # transcription réelle, exige NEXUS_WHISPER_MODEL
pnpm tauri build        # installateur Windows (à partir de Windows)
```

Dans un navigateur (`pnpm dev`), l'interface s'affiche, mais le lancement d'applications et les
informations système répondent explicitement qu'ils exigent l'application de bureau.

## Architecture

- `src/ui` : interface React (orbe, fenêtres, barre de commande). Aucune logique métier.
- `src/core` : moteur en TypeScript pur — intentions, capacités, tâches, placement, plugins.
- `plugins/<type>/<nom>/` : **un dossier par plugin**, rangé par type (`actions`, `sources`, `documents`, `speech`, `languages`), avec sa fiche `plugin.json`.
- `src-tauri/src` : noyau natif Rust ; le code natif des plugins est dans `src-tauri/src/plugins/<type>/`.

La convention des plugins et la piste d'une marketplace sont décrites dans [docs/PLUGINS.md](docs/PLUGINS.md).

Documentation complète : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/PERMISSIONS.md](docs/PERMISSIONS.md), [docs/DECISIONS.md](docs/DECISIONS.md).

## Confidentialité

- Aucune donnée n'est envoyée à un service externe en phase 1.
- Aucun micro n'est utilisé en phase 1.
- Aucune élévation de privilèges n'est demandée.

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md). Signaler une vulnérabilité : voir [SECURITY.md](SECURITY.md).

## Licence

MIT. Voir [LICENSE](LICENSE).
