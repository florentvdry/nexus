# À faire

Seul document de suivi. Remplace les anciens `PLAN.md` et `TODO-NEXUS-CLAUDE.md` (leur historique reste dans git).
Légende : `[x]` fait et vérifié, `[~]` partiel (ce qui manque est écrit), `[ ]` à faire, `[-]` écarté (raison donnée).
« Vérifié » veut dire : exécuté sur ce poste Windows (tests, application lancée, ou modèle réel), pas seulement compilé.

Dernière mise à jour : 25/10/2026, après les commits de la session (langage mesuré, annulation, UI Automation, thème).

## 1. Compréhension et modèle local

- [x] Toute demande passe par le modèle local, réponse contrainte par schéma et validée (ADR-029).
- [x] Corpus partagé de 129 demandes FR/EN (`src/core/language-model/corpus.json`), rejoué sur le modèle réel par `comprehension_bench` (Rust, ignoré par défaut).
- [x] Mesures sur ce poste (RTX 4060 8 Go, Ollama) : qwen2.5:14b 99,2 % à 4,6 s en moyenne ; qwen2.5:7b 96,9 % à 0,5 s ; qwen2.5:1.5b 86,8 %. Le choix automatique retient le 7b (ADR-045).
- [x] Niveau précis (14 B) écarté sur une carte de 8 Go : il déborderait dans la mémoire vive.
- [~] Mémoriser le niveau retenu : le modèle choisi est gardé. Relancer le test quand le matériel change : pas encore (signal à afficher dans les réglages).
- [ ] Profils « rapide / équilibré / précis / hors ligne strict » explicites.
- [ ] Faux négatifs connus : « ferme cette fenêtre » est lu comme WINDOW_CLOSE par les modèles 7 B et 14 B (ADR-045).
- [ ] Demander confirmation quand le modèle hésite : Ollama ne donne pas la confiance de façon fiable ici.
- [ ] Choisir la taille du modèle selon la tâche (petit pour les commandes, grand pour les questions ouvertes).
- [ ] Routeur hybride (fast-path déterministe pour les opérations connues) : ADR-029 l'a retiré ; à reprendre seulement si la mesure le justifie.
- [ ] Classification sémantique locale (embeddings) pour les paraphrases.

## 2. Mémoire

- [x] Souvenirs bornés au contexte : seuls ceux qui partagent des mots avec la demande, complétés par les plus récents, 12 au plus (ADR-046).
- [x] Oubli, export, suppression vérifiée sur le disque.
- [~] Vérification dans l'application : voir le rapport e2e (`docs/TESTING.md`).
- [ ] Recherche sémantique (embeddings, FTS5), provenance, date et confiance par souvenir.
- [ ] Résumer les conversations en souvenirs : [-] écarté, la conversation n'est pas conservée (choix de vie privée).

## 3. Fichiers

- [x] Renommer, déplacer, copier, corbeille : aperçu, confirmation du courtier, revalidation avant écriture.
- [x] Annuler la dernière action réussie (ADR-047) : renommage et déplacement remis en place, copie envoyée à la corbeille, corbeille restaurée. Restauration vérifiée sur Windows (test ignoré `live_restore`).
- [x] Journal d'audit sans contenu ni chemin en clair : une empreinte SHA-256 par demande, confirmée, refusée ou exécutée (`audit/actions.jsonl`).
- [~] Annulation d'une seule action : seule la dernière est gardée, en mémoire, et disparaît à la fermeture.
- [ ] Surveillance d'un dossier (notification quand un fichier apparaît).

## 4. Connecteurs MCP

- [x] Registre officiel seulement, 50 étoiles minimum, installation et appel après accord du courtier.
- [x] Jetons chiffrés par DPAPI ; clé NIM chiffrée ; périmètre lecture, écriture, suppression.
- [x] Réglage des accès écriture et suppression dans les réglages, chaque changement confirmé par le courtier (ADR-047).
- [x] Délai de 120 s par session, arrêt de l'arbre de processus (testé avec un serveur simulé).
- [~] Isolation : job object et environnement vidé. Pas de restriction réseau ni de fichiers : l'essai AppContainer bloque sur `0x800700CB` (bloc d'environnement). Décision prise, affichée avant chaque installation.
- [~] Version épinglée (`npx -y paquet@version`) ; pas de vérification d'intégrité du paquet.
- [ ] Test de bout en bout avec un vrai connecteur : nécessite un jeton de bot Discord.
- [-] Deuxième source de catalogue : écartée (Smithery héberge à distance ; voir ADR-027).

## 5. Bureau Windows

- [x] Fenêtres : lister, activer, demander la fermeture. Test live `live_notepad_is_listed_focused_and_closed` passe (liste et fermeture). L'activation est refusée par Windows quand le test est en arrière-plan : c'est signalé, pas caché.
- [x] Lecture des contrôles de la fenêtre active (UI Automation), hors NEXUS, mots de passe jamais lus, 150 contrôles au plus. Vérifié sur une vraie fenêtre (Chrome).
- [~] Activation d'un bouton : seuls les boutons uniques sont activés, après confirmation, fenêtre revérifiée. Non vérifié de bout en bout : Windows refuse de mettre le Bloc-notes au premier plan depuis un test. Test à lancer à la main (`live_invoke_maximizes_the_notepad_window`, Bloc-notes au premier plan).
- [ ] Saisie, sélection, défilement, onglets, tableaux : pas faits (seule l'activation de bouton existe).
- [ ] Adaptateur navigateur (Playwright) et OCR : pas faits.
- [x] Presse-papiers : traduire ou résumer, à la demande, avec le modèle local (ADR-051).
- [ ] Texte sélectionné : pas fait.
- [ ] Mise à jour Windows dans les alertes : pas faite.
- [ ] Contrôle `.cmd` de Claude Code et chemins avec lettre de lecteur : à valider avec un appel réel.
- [x] Reconnaissance vocale Whisper (« small » quantifié) : installée avec la voix, aller-retour Kokoro vers Whisper vérifié (ADR-058). Le micro n'a pas été testé.
- [ ] Voix Kokoro : qualité à écouter (non jugée à l'oreille), voix anglaise à installer et vérifier.

## 6. Voix

- [x] Voix neurale locale Kokoro, française et anglaise, installée après accord, repli sur la voix Windows (ADR-058).
- [~] Lecture à voix haute par Kokoro : l'application rend un WAV 24 kHz à la demande ; la qualité n'a pas été écoutée sur ce poste.
- [ ] Écoute permanente avec mot de réveil « Jarvis » : [ ] décision à prendre avec vous. Principe actuel : pas d'écoute sans activation. Un mot de réveil local et opt-in est possible, mais demande un modèle et un accord explicite.
- [ ] Barge-in (interrompre la réponse en la parlant) et lecture par segments.
- [x] Synthèse vocale Kokoro (demandée) : faite, ADR-058. ONNX Runtime 1.31 et espeak-ng sont téléchargés avec le modèle, sur accord.
- [ ] Routage vocal « jev » : demande non comprise, à préciser (Jarvis ?).
- [~] Obsidian pour la mémoire et les rapports : écriture confirmée dans `NEXUS/` (ADR-055), règles de chemin testées ; pas encore vérifiée dans l'application avec un vrai coffre.

## 7. Plugins

- [x] Plugins de données, plugins WebAssembly, validateur `nexus-plugin`, SDK Rust (`sdk/nexus-plugin-sdk`).
- [x] Visionneuse de fichiers : PDF, image, texte, Markdown, CSV, audio et vidéo, lecture seule (plugin `actions/file-view`).
- [x] Plugin `actions/ui-automation` (lecture et activation de bouton, voir section 5).
- [ ] Installation depuis un dépôt HTTPS public : aucun dépôt public n'existe encore.
- [ ] Appel réseau réussi d'un WebAssembly vers un hôte déclaré (seul le refus est testé).
- [ ] Publication du SDK sur crates.io : compte à créer, geste public à confirmer avec vous.
- [ ] Catalogue public (`index.json`) : pas hébergé.
- [ ] Permissions au-delà de `storage.local`, `network.fetch` et les permissions du bureau : à concevoir.

## 8. Recherche web et actualités

- [x] Sources classées : officielles et de référence avant le reste, commerciales en dernier et signalées au modèle (ADR-048).
- [x] Questions ouvertes, actualités, photos et fiches sans clé, avec sources citées.
- [ ] Vérifier les sources en vrai dans l'application pour chaque type de demande (voir rapport e2e).

## 9. Interface

- [x] Scène spatiale, orbe, rail, fenêtres flottantes, visionneuse.
- [x] Thème « Suivre Windows » par défaut, clair ou sombre au choix (ADR-048).
- [x] Taille du texte (accessibilité), mouvement réduit suivi.
- [ ] Mode discret (orbe seule, sans texte).
- [ ] Tour guidé et astuces après la première conversation.
- [ ] Fenêtres épinglables, minimisables, disposition persistante.
- [ ] Présentation « ordinateur intelligent » plus poussée (orbe, lisibilité, GPU faible).

## 10. OSINT et documents

- [x] Analyse passive d'un domaine (A/AAAA, certificats publics), analyse de fichier désigné (empreinte, type, statistiques), pseudos sur GitHub, GitLab, Codeberg.
- [x] Chaque résultat garde sa source, sa référence, son statut ; une correspondance n'est jamais une identité.
- [ ] Enregistrements MX, TXT, NS : le résolveur système ne les expose pas ; à faire avec un résolveur dédié.
- [ ] Métadonnées EXIF, PDF, Office.
- [ ] Graphe d'entités, chronologie, rapport exporté avec références.
- [ ] Sherlock/Maigret et e-mail : non faits (garde-fous de finalité à définir d'abord).
- [-] Reconnaissance faciale et suivi de personnes : hors périmètre.

## 11. Missions, mémoire évoluée, proactivité

- [ ] Moteur de missions multi-étapes (états, checkpoints, reprise, budgets).
- [ ] Cas développeur complet (projet, tests, diff, Claude Code, branche).
- [~] Alertes proactives : disque, mémoire, batterie (ADR-036, ADR-037). Pas de bus d'événements général.
- [ ] Notifications Windows regroupées, plage silencieuse, historique « pourquoi NEXUS me prévient ».
- [ ] Équipe d'agents et auto-amélioration : [-] reportés, aucun moteur mono-agent à ce stade.
- [-] Maison connectée : reportée, appareils et protocole à choisir avec vous.

## 12. Hygiène, livraison et README

- [x] README refait : fonctions réelles, mesures, tests de bout en bout, captures d'écran.
- [x] Documentation triée : un seul suivi (ce fichier), décisions dans `DECISIONS.md`, permissions dans `PERMISSIONS.md`.
- [x] `model_download.rs` gardé : il sert au téléchargement des voix et des modèles (la note précédente était fausse).
- [x] Clippy (`-D warnings`), tests Rust et tests TypeScript passent sur ce poste.
- [ ] Installateur public Windows : `pnpm tauri build` existe, il manque le worker déclaré comme binaire externe, la signature et la publication (geste public, à confirmer).
- [ ] Mises à jour vérifiées, migrations, récupération après mise à jour.
- [ ] CI : le job Windows n'a pas encore tourné sur GitHub depuis ces changements.
