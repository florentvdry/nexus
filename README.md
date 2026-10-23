# NEXUS

Assistant personnel intelligent pour Windows, open source, inspiré des interfaces de type JARVIS.
Vous formulez une intention ; NEXUS choisit les outils. Les commandes courantes s'exécutent en
local, sans modèle de langage et sans abonnement.

> **Statut : phase 1 terminée, phase 2 partiellement livrée** (la transcription attend le modèle Whisper).
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

**Modèle de reconnaissance** : il n'est pas inclus dans NEXUS. Téléchargez `ggml-base.bin` (multilingue, environ 148 Mo)
depuis le dépôt officiel de whisper.cpp, puis placez-le à l'emplacement affiché dans les réglages vocaux :

- Windows : `%APPDATA%\fr.nexus.assistant\models\ggml-base.bin`
- Autre : valeur de la variable d'environnement `NEXUS_WHISPER_MODEL`, si elle est définie.

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
- `src/core` : moteur en TypeScript pur — intentions, capacités, tâches, placement, engine.
- `src-tauri/src` : adaptateur Windows en Rust — informations système, catalogue d'applications.

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
