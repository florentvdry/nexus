# Plan de réalisation

Chaque phase a des livrables et des critères d'acceptation. Une phase n'est déclarée terminée que
si ses critères sont atteints et vérifiés.

## Phase 1 — Fondations et interface Windows

**Statut : livrée ; validation Windows à faire.**

### Livrables

- [x] Projet Tauri 2 + React + TypeScript + Vite, exécutable (`pnpm tauri build --debug --no-bundle`).
- [x] Architecture modulaire : core, adaptateur Windows, présentation, i18n.
- [x] Interface : fond sombre, orbe animée (7 états, un profil d'animation par état), zone des
      tâches en haut à gauche, fenêtres flottantes, barre de commande.
- [x] Saisie textuelle, classification déterministe FR/EN, aucun LLM.
- [x] Moteur de fenêtres flottantes : placement hors orbe et hors HUD, anti-chevauchement,
      réduction de taille, historique, redimensionnement, déplacement, fermeture.
- [x] Gestion des tâches avec états réels et annulation.
- [x] Commandes natives : lancement d'applications depuis un catalogue fermé, informations système.
- [x] Tests : 81 tests frontend (Vitest), 7 tests Rust (cargo test).

### Critères d'acceptation

| Critère | Résultat | Preuve |
|---|---|---|
| Taper « Lance le Bloc-notes » ouvre l'application | **Non vérifié sous Windows.** Sous Linux, la chaîne complète s'exécute et renvoie l'erreur attendue « Notepad is not installed » (`notepad.exe` absent). | Capture Xvfb, session de test |
| Demander CPU/RAM fait apparaître une fenêtre dans un espace libre | **Vérifié** avec les valeurs réelles de la machine de test (CPU, mémoire, disques). | Captures Xvfb |
| Aucun LLM nécessaire | **Vérifié par conception** : aucun code réseau ou modèle dans le chemin de commande ; `resolvedBy` vaut toujours `rules`. | Tests `parse.test.ts`, `engine.test.ts` |

### Tests exécutés

- `pnpm typecheck` : OK (TypeScript strict, `noUnusedLocals`).
- `pnpm test` : 81 tests OK (intentions, registre, tâches, placement, fenêtres, moteur, interface, orbe, i18n).
- `pnpm build` : OK.
- `cargo test` (src-tauri) : 7 tests OK, dont la résolution du catalogue et la lecture réelle de la mémoire.
- `cargo clippy --all-targets -- -D warnings` : OK.
- `pnpm tauri build --debug --no-bundle` : binaire produit.
- Test de bout en bout sous Xvfb : saisies au clavier réelles, captures d'écran contrôlées.

### Limites connues

- Le lancement n'a pas été testé sous Windows. Les chemins candidats (Chrome, Discord) suivent
  les emplacements d'installation standards, mais ne sont pas vérifiés sur une machine réelle.
- Pas encore d'icône de zone de notification, de raccourci global ni de démarrage automatique.
- Pas de redimensionnement manuel des fenêtres (déplacement seulement).
- Deux commandes identiques ouvrent deux fenêtres (pas de déduplication).
- Les états « en écoute », « reconnaissance vocale » et « réponse vocale » de l'orbe sont
  dessinés mais ne sont déclenchés qu'en phase 2.
- Pas encore de test visuel automatisé (captures comparées) ; les captures ont été vérifiées à la main.
- Le CI Windows est défini mais n'a pas encore été exécuté.

## Phase 2 — Voix et multilingue

**Statut : partiellement livrée. Validation bloquée sur le téléchargement du modèle Whisper.**

### Livrables

- [x] Détection de début et de fin de parole : Silero VAD v5/v6 (MIT) exécuté par tract, sans runtime natif.
- [x] Segmentation des énoncés (pauses courtes tolérées, silence de 600 ms pour clore, 15 s maximum).
- [x] Pipeline micro → VAD → transcription, avec événements vers l'interface (`voice://event`).
- [x] Transcription hors ligne par whisper.cpp (`whisper-rs` 0.16), derrière un trait `Transcriber`. Compilée, mais non exécutée (voir limites).
- [x] Détection de langue : celle de Whisper pour la voix, un comptage de mots fréquents pour le texte.
- [x] Réponse dans la langue de la commande, ou langue imposée dans les réglages.
- [x] Raccourci clavier global `Ctrl+Alt+Espace` (plugin Tauri, enregistrement Rust).
- [x] Interruption : parler ou taper interrompt la lecture en cours.
- [x] Synthèse vocale : voix du système via l'API Web Speech (WebView2 sur Windows, hors ligne), volume, vitesse, choix de la voix.
- [x] Réglages vocaux : interrupteur général, langue, réponses à voix haute, état et emplacement du modèle.
- [x] Saisie texte conservée et équivalente à la voix.
- [x] États de l'orbe : écoute et reconnaissance pilotées par les événements réels.

### Critères d'acceptation

| Critère | Résultat | Preuve |
|---|---|---|
| Commande orale simple en français ou en anglais, exécutée sans API payante | **Non vérifié de bout en bout.** Le VAD détecte la parole des audios FR et EN ; la transcription n'a pas pu être exécutée (modèle Whisper inaccessible). | Tests Rust VAD, test Whisper `--ignored` prêt |
| Raccourci global démarre l'écoute | **Vérifié** sous Xvfb : `Ctrl+Alt+Espace` → commande native → erreur `model-missing` affichée. | Capture `10-shortcut-no-model` |
| Modèle invalide signalé distinctement | **Vérifié** sous Xvfb avec un faux fichier : message `model-invalid`. | Capture `14-model-invalid` |
| Interruption de la réponse vocale | **Vérifié par tests** avec doubles (`controller.test.ts`). Non entendu en réel. | Tests |
| Réglages vocaux et langue de réponse | **Vérifié** : panneau affiché, réponses FR/EN selon la saisie. | Captures 11, 13 |
| Aucun flux audio envoyé à un service externe | **Vérifié par conception** : aucun appel réseau dans le chemin vocal ; Whisper et VAD sont locaux. | Revue du code |

### Tests exécutés

- Rust : 20 tests OK (décodage WAV, rééchantillonnage, VAD sur les fixtures FR et EN, segmentation, modèle manquant, modèle invalide), 1 test ignoré (transcription réelle, exige `NEXUS_WHISPER_MODEL`). `cargo clippy -D warnings` OK.
- Frontend : 106 tests OK (dont 25 nouveaux : détection de langue, réglages, contrôleur vocal avec doubles nommés, interface micro et panneau).
- `pnpm typecheck` et `pnpm build` OK.
- Bout en bout sous Xvfb : raccourci, erreurs `model-missing` et `model-invalid`, panneau de réglages, commandes texte en français.

### Limites connues

- **Bloquant : `huggingface.co` est refusé par la politique réseau de l'environnement de développement.** Les poids Whisper (`ggml-base.bin`) et les voix Piper y sont hébergés. Aucun paquet de registre autorisé ne fournit de modèle de reconnaissance français. Pour finir la validation : autoriser `huggingface.co` dans les réglages réseau, puis lancer `NEXUS_WHISPER_MODEL=... cargo test -- --ignored`.
- Le micro n'a pas pu être testé : aucun périphérique audio dans le conteneur. La capture (cpal) compile mais n'a pas tourné.
- La synthèse vocale n'a pas été entendue. Sous WebKitGTK, elle n'est pas disponible ; sous WebView2 (Windows), elle dépend des voix installées.
- Piper n'est pas intégré (ADR-008) : ses voix sont hébergées sur Hugging Face et espeak-ng, sa dépendance phonétique, est sous GPL.
- Pas de wake word (« Jarvis ») : seules la touche, le raccourci et le clic activent l'écoute. C'est un choix de confidentialité ; un mot d'activation local viendra plus tard.
- Pendant la transcription d'un énoncé (quelques secondes sur CPU), les nouveaux audios sont mis en file ; aucune perte, mais la réponse est retardée.
- Le CI Windows compile whisper.cpp (C++) : premier run à surveiller.

## Phase 3 — Moteur de plugins et premiers outils OSINT
Non commencée. Dépend de la décision sur l'isolation des processus.

## Phase 4 — Automatisation avancée de Windows
Non commencée.

## Phase 5 — Intelligence et écosystème
Non commencée.
