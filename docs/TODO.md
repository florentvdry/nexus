# À faire

État au dernier commit de la branche `claude/trusting-albattani-6y2gqv` (compréhension enrichie, plugins WebAssembly, journal, plugins de données).

## 1. Modèle de langage local (prochaine étape, décision de principe prise)

Objectif : comprendre les formulations que les règles ne couvrent pas, sans quitter la machine. Le modèle ne fait que
classer la demande en intention JSON existante. Les règles restent prioritaires. Aucune exécution directe par le modèle :
confirmations, racines autorisées et permissions restent identiques.

- [x] **Décider** : activation explicite, avec accord et taille affichés (recommandation retenue, ADR-025).
- [x] **Profil matériel** (Rust) : mémoire vive, cœurs, AVX2 et carte graphique (nom et mémoire dédiée, lus par DXGI, adaptateurs logiciels exclus) par `src-tauri/src/hardware.rs`, commande `hardware_profile`. Vérifié dans l'application le 23/10 : « NVIDIA GeForce RTX 4060 · 7.8 Go » affiché dans les réglages. Le choix des niveaux à partir du profil est dans `hardware.ts`.
- [ ] **Trois niveaux** : définis dans `src/core/language-model/tiers.ts` (ordres de grandeur). Reste à choisir les modèles candidats : vérifier la licence et le support du français de chacun avant de le proposer.
- [x] **Test de rapidité et de précision sur la machine**, à la première activation, après accord : le parcours télécharge le modèle recommandé après accord (taille affichée), le teste avec les 22 phrases de référence sur le vrai modèle, et ne garde que le niveau qui passe 3 s et 80 % (`install.ts`, `ModelInstaller.tsx`). Un niveau trop lent propose le suivant, après un nouvel accord. Écrit et testé avec un faux pont ; reste à essayer avec un vrai Ollama.
- [ ] **Mémoriser le choix**, le relancer seulement si le matériel ou le modèle change. Niveau modifiable dans les réglages.
- [x] **Intégration (Ollama, ADR-026)** : runtime Ollama sur `127.0.0.1:11434` (`src-tauri/src/ollama.rs`) : liste des modèles installés, classement avec sortie contrainte par schéma, commandes `ollama_status` et `model_classify(text, model)`. Écrit et testé avec un faux serveur local ; pas encore testé avec un vrai Ollama (à installer, avec ton accord).
- [x] **Choix du modèle visible** : l'utilisateur voit le modèle utilisé dans les réglages (section « Modèle de langage ») et le change parmi ceux qu'il a installés, ou désactive le modèle. Le modèle recommandé est signalé, jamais imposé. Écrit, non exécuté dans l'application.
- [ ] **Branchement** : branché dans le moteur (`engine.ts` appelle `understandWithModel` sur `UNKNOWN`, via le pont `classifyIntent` et la commande `model_classify`). Écrit, non exécuté. Tant qu'il n'y a pas de runtime, `model_classify` répond « modèle non installé » et les règles restent seules. Le nom d'application proposé par le modèle est retrouvé dans le même vocabulaire que les règles.
- [ ] **Téléchargement** : remplacé par Ollama (`ollama pull`, lancé par l'utilisateur, ADR-026). Le module `src-tauri/src/model_download.rs` n'est plus utilisé par le parcours ; à supprimer ou garder pour un usage futur. Ancienne description : module écrit (`src-tauri/src/model_download.rs`) : HTTPS seulement, nom de fichier sans séparateur, somme SHA-256 vérifiée avant renommage (fichier faux supprimé), reprise par `Range`, espace disque vérifié avec une marge de 512 Mo. Écrit, non exécuté. Pas encore de commande Tauri : il faut d'abord choisir le modèle, son adresse et sa somme.
- [ ] **Tests** : écrits (`language-model.test.ts`, `setup.test.ts`, `FirstRunSetup.test.tsx`, `hardware.rs`, `bridge.test.ts`), non exécutés pour l'instant. Test de précision réel à faire sur la machine cible.
- [ ] **Vie privée** : rien ne quitte la machine ; le journal des commandes reste désactivé par défaut.

Bloquant dans cet environnement : Hugging Face est refusé par le proxy. Le téléchargement et les mesures réelles doivent se faire sur la machine de l'utilisatrice / de l'utilisateur.

### 1bis. Assistant de premier lancement (décidé par l'utilisateur)

Au lancement, un parcours de configuration visible, étape par étape, sans rien faire en cachette :

- [x] **Profil de la machine** : mémoire, cœurs, AVX2 et carte graphique lus (commande `hardware_profile`) et affichés dans le parcours (`src/ui/FirstRunSetup.tsx`) et dans les réglages (section « Matériel », `src/ui/HardwareSection.tsx`).
- [ ] **Choix du mode** : écran écrit (automatique, « plus rapide », « plus précis », avec la taille du niveau). Le temps estimé n'est pas encore affiché : il viendra du test de référence.
- [ ] **Téléchargement** : taille, source, somme de contrôle, avec accord explicite et possibilité de passer.
- [ ] **Test sur la machine** : chaque phrase de référence et le résultat s'affichent au fil de l'eau (temps, réussite), avec possibilité d'annuler.
- [ ] **Résumé** : niveau retenu, raison, et réglage modifiable ensuite.
- [x] **Passer le parcours** : toujours possible, depuis l'écran et depuis les réglages (« Configurer le modèle local »). NEXUS reste utilisable avec les règles seules.
- [x] **Lancement automatique au premier démarrage** : le parcours s'ouvre si `nexus.modelSetup.seen` est absent du stockage local (même choix que la langue) ; il est marqué vu à la fermeture (passé, terminé ou ×). Écrit, non exécuté. Si le stockage est bloqué, il réapparaît à chaque lancement.
- [ ] **Résumé** : écran écrit (niveau retenu, ou règles seules). Changer le réglage depuis les réglages : à faire quand un niveau peut être installé.

### 1ter. Question ouverte : la compréhension par règles (à trancher)

Proposition de l'utilisateur : quand le modèle local est présent, retirer la compréhension par règles (`parser`).
Recommandation : **la garder**, mais en fonction de sécurité et de repli, pas comme compréhension principale :

- Sans modèle (installation refusée, machine trop lente, téléchargement échoué), NEXUS ne doit pas devenir inutilisable.
- Les commandes simples (« ouvre Discord », « ferme cette fenêtre », « arrête ») restent instantanées et sans risque d'erreur du modèle.
- Le modèle propose une intention ; les règles la valident (paramètres, chemins, racines autorisées) avant toute exécution.

Décision : garder les règles comme repli et validateur (ADR-025).

## 2. Vérifications qui restent à faire sur Windows

- [ ] **CI** : le job « Windows (Rust tests) » échoue sur `cargo clippy --all-targets -- -D warnings` depuis `bf56b58` (constaté via l'API GitHub). Les jobs frontend et « Windows (build de l'application) » passent. À corriger, puis clippy à relancer. Le log du job n'est pas accessible sans authentification (403) : les avertissements exacts sont à copier depuis GitHub, ou clippy à relancer en local. Le job Rust de `cfb4e6f` était vert.
- [ ] **Contrôle des fenêtres** : lister, activer, demander la fermeture, désignation par numéro après une question. Test live écrit (`live_notepad_is_listed_focused_and_closed` : ouvre un Bloc-notes et suit sa fenêtre par identifiant, sans toucher aux autres) ; à relancer, reporté à la demande de l'utilisateur tant qu'il joue.
- [x] **Corbeille** (crate `trash`) : test live `live_trash_moves_a_temporary_file_to_the_recycle_bin` passé ; le fichier reste dans la corbeille, à vider à la main.
- [ ] **Chemins `.cmd` de Claude Code** (`cmd /C`) et chemins avec lettre de lecteur : le CLI est installé (`claude.cmd`) ; le test réel appelle l'API, à lancer avec accord.
- [ ] **Reconnaissance vocale** : télécharger le modèle Whisper et tester une transcription réelle (FR et EN).
- [ ] **OSINT** : résultats réels sur `example.com`. Depuis cette machine : RDAP répond (200), crt.sh expire (délai dépassé).

## 3. Plugins

- [ ] **Installation depuis un dépôt HTTPS réel** : aucun dépôt de plugin public n'existe encore. Tester le chemin complet avec un dépôt de test.
- [ ] **Appel réseau réussi** d'un plugin WebAssembly vers un hôte déclaré (seul le refus d'un hôte non déclaré est testé).
- [ ] **Publier le SDK** `sdk/nexus-plugin-sdk` (crates.io) pour écrire un plugin sans cloner le dépôt.
- [ ] **Catalogue public** : un dépôt `index.json` avec un ou deux plugins, pour l'essai de bout en bout.
- [ ] **Permissions au-delà** de `storage.local` et `network.fetch` (fichiers, processus, micro) : à concevoir, pas avant d'avoir des utilisateurs.

## 4. Compréhension (limites actuelles, voir ADR-023)

- [ ] Formulations hors vocabulaire : traitées par le modèle local (point 1).
- [x] La mémoire de conversation n'est pas conservée au redémarrage : décidé, c'est voulu (vie privée). À réviser seulement si l'utilisateur le demande.
- [ ] Les questions sur fenêtres ambiguës ne se vérifient que par les tests moteur (pas de fenêtres sous Linux).

## 5. Nettoyage et hygiène

- [ ] Sandbox de test hors dépôt : `/root/Documents/nexus-e2e` (facture.txt, notes.txt). Chemin de la sandbox Linux d'origine, absent de cette machine : à supprimer là-bas.
- [x] `rust-version` 1.97 (requis par wasmtime 50) : instructions à jour dans `CONTRIBUTING.md` et le README.
- [ ] Après chaque build de l'app ici, vider `src-tauri/target/debug/incremental` : l'espace disque de la sandbox est très limité.

## 6. Décisions déjà prises (pour mémoire)

- Compréhension : règles d'abord, modèle local ensuite (ADR-023).
- Plugins avec code : WebAssembly, une seule fonction hôte, permissions approuvées dans le lock (ADR-022).
- Plugins de données : sans code, empreinte SHA-256 approuvée, deux confirmations à l'installation (ADR-019 à ADR-021).
- Journal des commandes : SQLite, désactivé par défaut, texte seulement (ADR-018).

## 7. Autorisations mémorisées (« toujours autoriser » par dossier ou par projet) — à reprendre

Demande : ne plus avoir à valider chaque action répétitive, comme Claude Code ou Codex. Garde-fous non négociables :
rien n'est silencieux, tout est révocable, et la suppression ne peut jamais être mémorisée.

Décisions prises :
- Mémorisables : écriture de fichiers (renommer, déplacer, copier) **dans un dossier donné**, et lancement de Claude Code **pour un projet donné**.
- Jamais mémorisables : suppression (corbeille), fermeture de fenêtre, installation ou suppression de plugin.
- Une règle ne couvre que les chemins situés dans le dossier, sans `..` (un dossier voisin au nom commençant pareil n'est pas couvert).
- Chaque action approuvée par règle est annoncée dans la conversation et gardée dans un journal visible.

État :
- [x] **Natif (Rust), commité** : `permissions.rs` réécrit — règles persistées (`permission_rules.json`), portée (`scope_for`, `covers`), `auto_approve`, journal, `answer_with(remember)`. Tests : 17 tests de permissions, dont le refus de la suppression mémorisée et des remontées de chemin. Commandes `permission_rules`, `permission_revoke`, `permission_audit` et `permission_answer(remember)` ajoutées dans `lib.rs`.
- [x] **Interface** (reprise à zéro, le brouillon n'était pas dans le dépôt) : pont (`bridge.ts` : `answerConfirmation(…, remember)`, `listRules`, `revokeRule`, `listAudit`, `onAutoApproval`), champs `rememberable` et `scope` de la demande, case à cocher sur la carte de confirmation (`PresentedContentView.tsx`), annonce des approbations automatiques par le moteur (`engine.ts`), section « Autorisations mémorisées » dans les réglages (`PermissionsSection.tsx`).
- [x] **Tests** : moteur (case seulement pour une action mémorisable, annonce d'une approbation automatique), pont (`remember` transmis, commandes de règles), carte (case visible seulement si `remember`, refus sans règle), section (liste, révocation, journal).
- [x] **Vérification dans l'application** (Windows, `pnpm tauri dev`) : fait le 23/10, 16 vérifications réussies sur la vraie fenêtre (script de pilotage via le port de débogage WebView2, dossier de test créé puis supprimé) : confirmation avec la case pour le dossier, renommage approuvé, second renommage sans question et annoncé, suppression toujours demandée sans case, refus conservant le fichier, règle listée puis révoquée, question de nouveau posée. Le premier lancement a aussi été vérifié : le parcours s'ouvre une fois, le profil lu (31,8 Go, 8 cœurs, AVX2) et « Passer » le marque vu.

Documentation mise à jour : `docs/PERMISSIONS.md` (section autorisations mémorisées) et ADR-024 (`docs/DECISIONS.md`).

## 8. README à refaire, plus soigné

- [x] Refaire le README : présentation courte, tableau des fonctions, exemples de phrases, installation.
- [ ] Captures d'écran de l'application (orbe, fenêtres, confirmation, réglages) : à prendre sur l'application de bureau, pas en navigateur.
- [x] Séparer le README utilisateur (ce que fait NEXUS) du guide de développement : prérequis, commandes et architecture sont dans `CONTRIBUTING.md`.
- [x] Ajouter des badges utiles (CI, licence) et un lien vers la spécification des plugins.
- [ ] Installation pour Windows sans compiler : pas d'installateur public pour l'instant (`pnpm tauri build` existe, à publier).
