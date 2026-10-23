# À faire

État au dernier commit de la branche `claude/trusting-albattani-6y2gqv` (compréhension enrichie, plugins WebAssembly, journal, plugins de données).

## 1. Modèle de langage local (prochaine étape, décision de principe prise)

Objectif : comprendre les formulations que les règles ne couvrent pas, sans quitter la machine. Le modèle ne fait que
classer la demande en intention JSON existante. Les règles restent prioritaires. Aucune exécution directe par le modèle :
confirmations, racines autorisées et permissions restent identiques.

- [ ] **Décider** : téléchargement du modèle au premier lancement, ou seulement à l'activation explicite de la compréhension avancée (recommandation : activation explicite, avec accord et taille affichée).
- [ ] **Profil matériel** (Rust) : mémoire vive, cœurs, AVX2, carte graphique et mémoire vidéo.
- [ ] **Trois niveaux** : léger (~1 Md de paramètres, < 1 Go), équilibré (~3 Md, ~2 Go), précis (~7-8 Md, ~5 Go, seulement sur machine adaptée). Vérifier la licence et le support du français de chaque modèle candidat avant de le proposer.
- [ ] **Test de rapidité et de précision sur la machine**, à la première activation, après accord : une vingtaine de phrases de référence, par le niveau le plus précis au plus léger. On garde le plus précis sous le temps limite (≈ 3 s par phrase) et au-dessus du seuil de réussite.
- [ ] **Mémoriser le choix**, le relancer seulement si le matériel ou le modèle change. Niveau modifiable dans les réglages.
- [ ] **Intégration** : runtime llama.cpp (crate `llama-cpp-2` ou équivalent), sortie contrainte par grammaire JSON sur les intentions connues, exécution en tâche de fond avec délai et annulation.
- [ ] **Branchement** : appelé seulement quand `parseIntent` renvoie `UNKNOWN`. Résultat re-validé par les règles (intention connue, paramètres valides) avant d'être exécuté.
- [ ] **Téléchargement** : adresse HTTPS, somme de contrôle SHA-256 vérifiée, reprise possible, espace disque vérifié avant.
- [ ] **Tests** : modèle factice pour le format et les délais ; test de précision réel à faire sur la machine cible.
- [ ] **Vie privée** : rien ne quitte la machine ; le journal des commandes reste désactivé par défaut.

Bloquant dans cet environnement : Hugging Face est refusé par le proxy. Le téléchargement et les mesures réelles doivent se faire sur la machine de l'utilisatrice / de l'utilisateur.

### 1bis. Assistant de premier lancement (décidé par l'utilisateur)

Au lancement, un parcours de configuration visible, étape par étape, sans rien faire en cachette :

- [ ] **Profil de la machine** : mémoire, cœurs, carte graphique, affiché tel quel.
- [ ] **Choix du mode** : automatique (le test décide), ou manuel : « plus rapide » ou « plus précis » (niveau imposé, avec sa taille et son temps estimé).
- [ ] **Téléchargement** : taille, source, somme de contrôle, avec accord explicite et possibilité de passer.
- [ ] **Test sur la machine** : chaque phrase de référence et le résultat s'affichent au fil de l'eau (temps, réussite), avec possibilité d'annuler.
- [ ] **Résumé** : niveau retenu, raison, et réglage modifiable ensuite.
- [ ] **Passer le parcours** : NEXUS reste utilisable, avec les règles seules, et le parcours reste accessible depuis les réglages.

### 1ter. Question ouverte : la compréhension par règles (à trancher)

Proposition de l'utilisateur : quand le modèle local est présent, retirer la compréhension par règles (`parser`).
Recommandation : **la garder**, mais en fonction de sécurité et de repli, pas comme compréhension principale :

- Sans modèle (installation refusée, machine trop lente, téléchargement échoué), NEXUS ne doit pas devenir inutilisable.
- Les commandes simples (« ouvre Discord », « ferme cette fenêtre », « arrête ») restent instantanées et sans risque d'erreur du modèle.
- Le modèle propose une intention ; les règles la valident (paramètres, chemins, racines autorisées) avant toute exécution.

Décision à prendre : garder les règles comme repli et validateur (recommandé), ou les retirer complètement.

## 2. Vérifications qui restent à faire sur Windows

- [ ] **CI** : vérifier que le job « Windows (Rust tests) » et le job « Windows (build de l'application) » passent sur le dernier commit (`bf56b58` et suivants). Le job Rust de `cfb4e6f` est vert.
- [ ] **Contrôle des fenêtres** : lister, activer, demander la fermeture, désignation par numéro après une question. Compilé pour MSVC mais jamais exécuté.
- [ ] **Corbeille** (crate `trash`), chemins `.cmd` de Claude Code (`cmd /C`), chemins avec lettre de lecteur.
- [ ] **Reconnaissance vocale** : télécharger le modèle Whisper et tester une transcription réelle (FR et EN).
- [ ] **OSINT** : résultats réels sur `example.com` (crt.sh, DNS, RDAP bloqués ici).

## 3. Plugins

- [ ] **Installation depuis un dépôt HTTPS réel** : aucun dépôt de plugin public n'existe encore. Tester le chemin complet avec un dépôt de test.
- [ ] **Appel réseau réussi** d'un plugin WebAssembly vers un hôte déclaré (seul le refus d'un hôte non déclaré est testé).
- [ ] **Publier le SDK** `sdk/nexus-plugin-sdk` (crates.io) pour écrire un plugin sans cloner le dépôt.
- [ ] **Catalogue public** : un dépôt `index.json` avec un ou deux plugins, pour l'essai de bout en bout.
- [ ] **Permissions au-delà** de `storage.local` et `network.fetch` (fichiers, processus, micro) : à concevoir, pas avant d'avoir des utilisateurs.

## 4. Compréhension (limites actuelles, voir ADR-023)

- [ ] Formulations hors vocabulaire : traitées par le modèle local (point 1).
- [ ] La mémoire de conversation n'est pas conservée au redémarrage : décider si c'est souhaitable.
- [ ] Les questions sur fenêtres ambiguës ne se vérifient que par les tests moteur (pas de fenêtres sous Linux).

## 5. Nettoyage et hygiène

- [ ] Sandbox de test hors dépôt : `/root/Documents/nexus-e2e` (facture.txt, notes.txt) à supprimer quand plus utile.
- [ ] `rust-version` passé à 1.97 (requis par wasmtime 50) : mettre à jour les instructions d'installation des contributeurs si besoin.
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
- [ ] **Interface, NON commité** (ébauche incohérente, à refaire) : pont (`bridge.ts` : `answerConfirmation(…, remember)`, `listRules`, `revokeRule`, `listAudit`, `onAutoApproval`), type de présentation (`rememberable`, `scope`), case à cocher sur la carte de confirmation, annonce des autorisations automatiques par le moteur, section « Autorisations mémorisées » dans les réglages.
  Erreurs TypeScript connues dans l'ébauche : clés i18n absentes (`permissions.*`, `confirm.remember.*`), champ `permission` absent de la présentation, `#announceAutomatic` mal orthographié, tests fictifs à compléter (`emitConfirmation` sans `rememberable`).
- [ ] **Tests à écrire** : moteur (annonce d'une action automatique), pont (`remember` transmis), carte (case visible seulement si `rememberable` et `scope`).
- [ ] **Vérification dans l'application** : approuver « toujours » sur un renommage, refaire un renommage dans le même dossier sans question, vérifier la mention et la révocation, vérifier qu'une suppression pose toujours la question.

Documentation à mettre à jour après : `docs/PERMISSIONS.md` (section autorisations mémorisées) et un ADR-024.

## 8. README à refaire, plus soigné

- [ ] Refaire le README : présentation courte, captures d'écran de l'application (orbe, fenêtres, confirmation, réglages), tableau des fonctions, exemples de phrases, installation claire pour Windows.
- [ ] Séparer le README utilisateur (ce que fait NEXUS) du guide de développement (`CONTRIBUTING.md`, `docs/`).
- [ ] Ajouter des badges utiles (CI, licence) et un lien vers la spécification des plugins.
