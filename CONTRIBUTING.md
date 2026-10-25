# Contribuer à NEXUS

Merci de votre intérêt. Quelques règles pour garder le projet stable et compréhensible.

## Principes

1. **Pas de données simulées présentées comme réelles.** Une simulation doit être explicitement
   nommée comme telle, et réservée aux tests.
2. **Pas de logique métier dans l'interface.** Les composants de `src/ui` appellent le moteur.
3. **Pas de commande libre.** Le lancement ne peut viser qu'une application trouvée par le scan du PC (`src-tauri/src/plugins/actions/apps.rs`). Aucun catalogue d'applications n'est tenu.
4. **Pas de règle de texte pour comprendre une demande.** Toute compréhension passe par le modèle local, dont la réponse est validée (ADR-029). Une fois l'intention comprise, la capacité qui l'exécute reste déterministe.
5. **Chaque capacité déclare son manifeste** : permissions, localité, délai, coût.
6. **Les erreurs ne sont jamais masquées.** Elles apparaissent sous forme de carte d'erreur.

## Mise en place

Prérequis :

- Node.js 22 et pnpm 10
- Rust 1.97 ou plus récent
- Sous Windows : Microsoft Edge WebView2 (présent sur Windows 11), et Visual Studio Build Tools (charge C++) avec CMake et
  LLVM/Clang, pour compiler whisper.cpp
- Sous Linux (pour compiler seulement) : `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libssl-dev libxdo-dev libasound2-dev cmake clang`
- Facultatifs : Ollama, pour comprendre les demandes (NEXUS propose de l'installer au premier lancement), Node.js pour les
  connecteurs MCP, et le CLI `claude` pour Claude Code.

```bash
pnpm install
pnpm tauri dev          # application de bureau en développement
pnpm test               # tests frontend (Vitest)
pnpm typecheck          # TypeScript strict
cd src-tauri && cargo test                          # tests Rust
cd src-tauri && cargo test -- --ignored            # transcription réelle, exige NEXUS_WHISPER_MODEL
pnpm tauri build        # installateur Windows (à partir de Windows)
```

Dans un navigateur (`pnpm dev`), l'interface s'affiche, mais le lancement d'applications et les informations système
répondent explicitement qu'ils exigent l'application de bureau.

## Architecture

- `src/ui` : interface React (orbe, fenêtres, barre de commande). Aucune logique métier.
- `src/core` : moteur en TypeScript pur — compréhension (modèle local), capacités, tâches, placement, plugins.
- `plugins/<type>/<nom>/` : **un dossier par plugin**, rangé par type (`actions`, `agents`, `sources`, `documents`, `speech`, `languages`), avec sa fiche `plugin.json`.
- `src-tauri/src` : noyau natif Rust ; le code natif des plugins est dans `src-tauri/src/plugins/<type>/`.

La convention des plugins et la piste d'une marketplace sont décrites dans [docs/PLUGINS.md](docs/PLUGINS.md).
Documentation complète : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/PERMISSIONS.md](docs/PERMISSIONS.md),
[docs/DECISIONS.md](docs/DECISIONS.md).

## Applications lançables

Rien à ajouter : NEXUS ne tient pas de liste. Le scan (`apps.rs`) lit le menu Démarrer, le registre (« App Paths ») et les dossiers des programmes, puis lance ce qu'il trouve par son nom. Pour changer ce qui est reconnu, modifier les sources du scan, pas une liste.

Un nom dit autrement par l'utilisateur peut être ajouté par un paquet `aliases` (voir `docs/PLUGIN-SPEC.md`).

## Ajouter une capacité

Voir `plugins/actions/app-launch/` comme modèle, et `docs/PLUGINS.md` pour la fiche `plugin.json`. Toute capacité
doit être déclarée dans la fiche. Les entrées doivent rester sérialisables.

## Messages de commit

Format court et descriptif, en français ou en anglais : `feat:`, `fix:`, `docs:`, `test:`, `ci:`.
