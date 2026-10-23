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

**Statut : non commencée. Bloquée par deux points à trancher, voir ci-dessous.**

Livrables prévus : reconnaissance vocale locale (whisper.cpp + Silero VAD), synthèse locale
(Piper), détection de langue, raccourci clavier global, interruption des réponses, paramètres vocaux.

Points bloquants :
1. **Entrée audio** : l'environnement de développement n'a pas de microphone. Les critères
   « donner une commande orale » ne peuvent être vérifiés que sur une machine avec micro, ou par
   lecture de fichiers audio de test.
2. **Licences et modèles** : il faut vérifier la licence de chaque modèle et de chaque
   bibliothèque avant intégration (whisper.cpp MIT, Silero VAD MIT, Piper MIT, mais espeak-ng
   utilisé par Piper est GPL : à examiner). Les modèles seront téléchargés, pas embarqués.

## Phase 3 — Moteur de plugins et premiers outils OSINT
Non commencée. Dépend de la décision sur l'isolation des processus.

## Phase 4 — Automatisation avancée de Windows
Non commencée.

## Phase 5 — Intelligence et écosystème
Non commencée.
