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

**Statut : implémentée et testée ; le critère « résultats réels sur example.com » n'est pas validé dans cet environnement.**

### Livrables

- [x] Contrat de capacité (manifeste, permissions, délai, localité, coût) appliqué par le registre.
- [x] Exécution isolée : chaque connecteur tourne dans un processus `nexus-worker` séparé, avec délai (arrêt forcé) et sortie bornée (4 Mo). Une erreur ou un blocage du worker ne fait pas tomber NEXUS.
- [x] Modèle normalisé : entité, valeur, source avec URL, date de collecte, statut, confiance, détails, note de limite.
- [x] Statuts : vérifié, correspondance possible, non vérifié, introuvable, source inaccessible, erreur.
- [x] Connecteurs passifs : DNS A/AAAA (résolveur du système), certificats publics (crt.sh), présence de pseudo (GitHub, GitLab, Codeberg : une requête par plateforme, espacées).
- [x] Analyse locale de fichier désigné : SHA-256, taille, type détecté, lignes et mots. Le contenu n'est ni copié ni affiché.
- [x] Résultats partiels : une source en erreur est listée ; le résumé indique le nombre d'erreurs.
- [x] Intentions : « analyse example.com », « cherche le pseudo X », « analyse le fichier C:\… ». Les adresses email sont refusées explicitement.
- [x] Affichage en fenêtres : tableau des éléments, détails du fichier, limites de lecture, sources en erreur.

### Critère d'acceptation

« L'utilisateur demande une analyse passive de `example.com`. JARVIS sélectionne les sources adaptées, lance les vérifications et affiche les résultats réellement obtenus avec leurs références. »

| Partie | Résultat | Preuve |
|---|---|---|
| Sélection des sources et lancement des vérifications | **Vérifié** : DNS puis crt.sh sont lancés, avec leur propre identifiant de recherche. | Test `osint.test.ts`, E2E Xvfb |
| Affichage des résultats réellement obtenus | **Vérifié** : les erreurs réelles s'affichent (DNS sans résolveur, crt.sh refusé par le proxy). | Capture `23-final-osint` |
| Résultats positifs réels pour example.com | **Non validé.** Ce conteneur n'a pas de résolveur DNS et refuse crt.sh. Sur une machine normale, le connecteur doit donner des adresses et des noms de certificats. | À vérifier sous Windows |

### Tests exécutés

- Rust : 38 tests OK, 1 ignoré (transcription Whisper). Les tests de connecteurs couvrent : validation des cibles, DNS sur `localhost` (résolution réelle), analyse d'un fichier réel, rapports de crt.sh et des pseudos contre un **serveur de simulation local** (étiqueté comme tel), délai et arrêt du worker, sortie d'un worker en échec.
- Worker exécuté seul sur entrée standard : analyse d'un fichier réel OK ; cible invalide, connecteur inconnu et JSON invalide refusés avec code de sortie.
- Frontend : 123 tests OK, dont les règles OSINT (intentions, agrégation, statuts, email refusé) avec un runner simulé étiqueté.
- Clippy `-D warnings` OK. Typecheck et build OK.
- E2E Xvfb : analyse de fichier réussie ; analyse de domaine et de pseudo affichant les sources en erreur réelles.

### Limites connues

- **Réseau de l'environnement de développement** : `crt.sh`, RDAP, DNS-over-HTTPS et `example.com` sont refusés ; la résolution DNS locale ne répond pas. Pour une validation complète, il faut autoriser ces hôtes.
- Pas de sources d'emails (phase ultérieure, avec garde-fous de finalité et de consentement).
- Pas de recherche de pseudo sur d'autres plateformes ; la liste est fixe dans le code. Une correspondance n'est jamais une identité.
- Les enregistrements MX, TXT et NS ne sont pas résolus : le résolveur du système ne les expose pas. Ajout prévu avec un résolveur DNS dédié.
- Le worker est compilé à côté de l'application en développement. **Avant un installateur**, il faut le déclarer comme binaire externe (`bundle.externalBinaries`) pour chaque cible.
- Le plugin de connecteurs n'est pas encore chargé depuis un dossier : les connecteurs sont intégrés au binaire. L'API externe viendra avec la phase 5.
- Pas d'analyse de métadonnées EXIF ni de texte de PDF : seules l'empreinte, le type et les statistiques de texte sont calculées.
- Les vérifications TLS utilisent le magasin de certificats de l'OS (`platform-verifier`). Sur Linux, un proxy d'inspection peut encore échouer : c'est l'environnement, pas le code.

## Phase 4 — Automatisation avancée de Windows

**Statut : implémentée et testée sous Linux (Xvfb) ; non validée sous Windows. Le contrôle des fenêtres est reporté.**

### Livrables

- [x] Recherche de fichiers par nom, extension, période et dossier, limitée aux dossiers utilisateur (Documents, Téléchargements, Bureau, Images). Le dossier personnel n'est jamais une racine autorisée.
- [x] Aperçu puis confirmation pour chaque modification : renommer, déplacer, envoyer à la corbeille. Une suppression définitive n'existe pas.
- [x] Processus actifs, triés par mémoire utilisée (lecture seule).
- [x] Permissions natives : la confirmation est exigée par le backend Rust, pas seulement par l'interface. Une demande expire après 120 secondes et une réponse inconnue est refusée.
- [x] Intégration Claude Code : détection du CLI, exécution non interactive (`-p --output-format stream-json`), demande transmise sur l'entrée standard (jamais dans la ligne de commande), budget plafonné à 0,50 $ par run, annulation, délai de 15 minutes, flux d'événements affiché (outils, réponse, refus, coût, durée).
- [x] Applications installées : catalogue de lancement avec statut (en cours ou non) ; pas de détection des installations hors catalogue.
- [x] Contrôle des fenêtres Windows (lister, activer, demander la fermeture) : implémenté avec confirmation, Windows uniquement. Non exécuté sous Windows dans cet environnement : la vérification est faite par la compilation croisée et par le job CI Windows.

### Critère d'acceptation

« Chercher des fichiers, les renommer ou les déplacer après confirmation, voir les processus actifs, et lancer Claude Code dans un projet en voyant son résultat. Aucune action destructive sans confirmation explicite. »

| Partie | Résultat | Preuve |
|---|---|---|
| Recherche limitée aux dossiers utilisateur | **Vérifié** sous Xvfb. Une erreur de conception avait exposé le dossier personnel (113 résultats, dont des fichiers de `~/.claude`) ; corrigée et couverte par un test. | Capture `51-file-search.png` : 2 résultats, tous dans `nexus-e2e` |
| Renommage après confirmation | **Vérifié** : refus → fichier inchangé ; autorisation → fichier renommé sur le disque. | Captures `52`, `53`, `56`, `57` |
| Lancement de Claude Code après confirmation | **Vérifié** avec le CLI réel (2.1.309) : réponse affichée, coût 0,0093 $, durée 5 s, 1 outil. | Capture `62-agent-rerun.png` |
| Contrôle des fenêtres | **Non réalisé.** | — |
| Comportement sous Windows (corbeille, `.cmd`, chemins) | **Non validé.** | À vérifier sous Windows |

### Tests exécutés

- Rust : 63 tests OK, 2 ignorés (transcription Whisper ; test réel du CLI Claude Code, lancé à part avec `--ignored`). Clippy `-D warnings` OK.
- Rust, Claude Code : relecture d'une sortie réelle enregistrée du CLI, annulation d'un faux CLI bloquant, CLI en échec, refus de permission, format des événements envoyés à l'interface (noms en camelCase vérifiés).
- Frontend : typecheck OK, 153 tests OK. Règles d'intention couvertes ; les appels natifs sont simulés dans `native-actions.test.ts` (simulation étiquetée).
- E2E Xvfb : recherche, renommage refusé, renommage autorisé, lancement de Claude Code avec confirmation et résultat réel.

### Corrections trouvées pendant la validation

- Le dossier personnel apparaissait dans la recherche (repli de la bibliothèque `dirs`). Corrigé : seuls les sous-dossiers canoniques sont des racines.
- Le coût et la durée de Claude Code affichaient `NaN` : les champs étaient envoyés en `snake_case`. Corrigé et couvert par un test.
- La confirmation affichait seulement un symbole après réponse. Le texte est maintenant traduit.

### Limites connues

- Le lancement passe par le catalogue ; les applications installées hors catalogue ne sont pas détectées.
- Le chemin `.cmd` de Claude Code (`cmd /C`) et la corbeille (crate `trash`) ne sont pas testés sous Windows.
- La tâche « Claude Code en cours » s'affiche avant la confirmation : c'est un libellé à améliorer.
- Le contrôle des fenêtres n'a pas été exécuté sur Windows : les appels Win32 sont compilés pour la cible MSVC, mais pas lancés.
- Les demandes de permission propres à Claude Code restent actives. Un outil refusé est affiché comme tel, jamais contourné.
- L'identité des appelants est vérifiée côté natif, mais elle est fournie par la fenêtre : elle ne résiste pas à du code hostile dans la même fenêtre (voir `docs/PERMISSIONS.md`).

## Phase 5 — Intelligence et écosystème

**Statut : première brique livrée (journal des commandes). Chargement des plugins depuis le disque, marketplace et modèle de langage : non commencés.**

### Livrables

- [x] Identité des appelants côté natif : chaque plugin ne peut exercer que les permissions de son manifeste, et seule l'interface répond aux confirmations (voir `docs/PERMISSIONS.md`).
- [x] Journal local des commandes dans SQLite : désactivé par défaut, 500 commandes au plus, vidable, réservé à l'interface.
- [x] Réglage du journal dans les options, avec les dernières commandes affichées.
- [x] Plugins de données chargés depuis un dossier utilisateur : validation, approbation par empreinte, lock, revérification à chaque commande (spécification : `docs/PLUGIN-SPEC.md`).
- [x] Installation depuis un dépôt Git HTTPS ou un dossier local, avec deux confirmations et suppression confirmée.
- [x] Validateur officiel `nexus-plugin`, utilisé par la CI sur les exemples.
- [x] Format de catalogue défini (`index.json`, adresse configurée par `NEXUS_PLUGIN_INDEX`). Aucun catalogue public n'existe encore : le site de référence (plugins.omarchy.org) n'est pas joignable depuis cet environnement.
- [ ] Plugins avec code : attendent la décision WebAssembly ou iframe (spécification, § 10).
- [ ] Signature des auteurs, métriques sociales et mises à jour automatiques : hors périmètre de la version 1.
- [ ] Modèle de langage local ou distant pour les cas que les règles ne couvrent pas.

### Critère d'acceptation (journal)

« Activé, le journal garde les commandes récentes et les affiche dans les options. Désactivé, rien n'est écrit. Un plugin ne peut ni lire ni écrire dans le journal. »

| Partie | Résultat | Preuve |
|---|---|---|
| Rien n'est écrit tant que l'option est désactivée | **Vérifié** : tests Rust et test d'intégration de l'engine | `journal.rs`, `native-actions.test.ts` |
| Commandes affichées dans les options | **Vérifié** sous Xvfb : la commande « show my computer information » apparaît avec son heure | Capture `81-journal-on.png` |
| Plugin refusé sur le journal | **Vérifié** par le code (`require_core`) et les tests de pont | `grants.rs`, `bridge.test.ts` |

### Tests exécutés

- Rust : 76 tests OK, 2 ignorés (Whisper et CLI réel). Clippy `-D warnings` OK. Cinq tests du journal, dont la persistance entre deux ouvertures du fichier.
- Frontend : typecheck OK, 176 tests OK.
- E2E Xvfb : recherche de fichiers toujours fonctionnelle après le passage de l'identité ; contrôle des fenêtres affiche « Indisponible sur cette plateforme » sous Linux ; journal activé, commande enregistrée.

### Limites connues

- Le journal conserve le texte des commandes, qui peut contenir des chemins. C'est pourquoi il est désactivé par défaut.
- Les plugins avec code restent compilés dans l'application.
- L'installation depuis une adresse HTTPS n'a été testée qu'avec un dépôt Git local : aucun dépôt HTTPS public de plugin n'existe pour l'instant.
- Le validateur et l'installation vérifient l'empreinte, pas l'identité de l'auteur.
- Le modèle de langage n'est pas branché : toute compréhension reste déterministe.
