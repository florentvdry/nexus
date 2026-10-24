# À faire

État au commit `4754d7b` sur `main` (connecteurs MCP). Les changements suivants ne sont **pas encore commités** : mémoire, première conversation, analyseur par règles retiré (tout passe par le modèle local). Voir ADR-027 à ADR-029 dans `docs/DECISIONS.md`.

## 0. Feuille de route de la nuit (amélioration continue)

Cap : une demande = une fenêtre ; tâches du quotidien simplifiées ; NEXUS comme couche d'intelligence sur le PC.
Relevé des usages et des assistants : `docs/RESEARCH.md`.

Ordre, sans commit ni test sur le PC :
1. [x] **Tâches programmées** (ADR-030, testées, non vérifiées dans l'application) : « rappelle-moi demain à 9 h », « chaque lundi, résume mes actus ». Une tâche planifiée ne peut pas en planifier d'autres (règle Hermes).
2. [x] **Fenêtres par demande** (ADR-031) : photo (Wikimedia Commons) et fiche sujet (Wikipédia), testées. **Actualités** : « à la une » du jour, Wikipédia fr (vérifié).
3. [ ] **Date et heure dans le contexte du modèle**, pour comprendre « demain », « lundi », « ce soir ».
4. [ ] **Mémoire des routines** : retenir les habitudes répétées, pas seulement des faits.

## 1. Modèle de langage local

Le modèle comprend toutes les demandes (ADR-029). Sans modèle prêt, NEXUS le dit et ne devine rien.

- [ ] **Niveaux** : choisir les modèles candidats pour chaque niveau (`src/core/language-model/tiers.ts`), en vérifiant la licence et la qualité du français.
- [ ] **Mémoriser le niveau retenu** : le relancer seulement si le matériel ou le modèle change. Modifiable dans les réglages.
- [ ] **Précision réelle** : mesurer les 22 phrases de référence sur la machine cible. Le test de précision a été retiré de la décision de niveau, seule la vitesse compte ; à revoir avec les mesures réelles.
- [ ] **Petit modèle** : le niveau léger (1,5 B) est le plus fragile pour comprendre. À évaluer une fois les niveaux choisis.
- [ ] **`model_download.rs`** : module non utilisé par le parcours (Ollama gère les téléchargements). À supprimer ou à garder pour un usage futur.
- [x] Profil matériel (RAM, cœurs, AVX2, carte graphique DXGI), affiché dans les réglages. Vérifié dans l'application.
- [x] Intégration Ollama : liste des modèles, classement à sortie contrainte, commandes `ollama_status` et `model_classify`.
- [x] Choix du modèle visible dans les réglages, modifiable ou désactivable.
- [x] Branchement : toute demande passe par le modèle (`understandWithModel`). Plus de règles de texte.

## 2. Parcours de premier lancement

- [ ] **Mode** : écran écrit. Afficher le temps estimé (à tirer du test de référence).
- [ ] **Test sur la machine** : résultats phrase par phrase, avec possibilité d'annuler.
- [ ] **Résumé** : écran de résumé (niveau retenu) et changement du niveau depuis les réglages.
- [x] Installation d'Ollama et du modèle après accord, avec barre de progression ; le parcours bloque l'application tant que tout n'est pas prêt.
- [x] Première conversation après le setup : sept questions (prénom, lieu, activité, usage, ton, longueur des réponses, limites), réponses gardées en souvenirs, passables une à une.

## 3. Mémoire et préférences

- [ ] **Vérifier dans l'application** : enregistrement automatique par le modèle, oubli, section Mémoire des réglages, première conversation.
- [ ] **Surveiller la taille du contexte** : aucune limite de souvenirs. Au-delà d'une certaine quantité, le modèle recevra trop de texte. Voir l'idée de recherche par pertinence (section 7).
- [x] Souvenirs enregistrés localement, sans limite de nombre ; « tout oublier » demande confirmation.

## 4. Connecteurs MCP

- [ ] **Test de bout en bout** avec un vrai connecteur (nécessite Node.js, un jeton de bot Discord et un modèle qui choisisse bien `NEEDS_CONNECTOR`).
- [ ] **Chiffrer les jetons** : les valeurs sont gardées en clair dans `mcp/installed.json`. Chiffrement Windows (DPAPI) à faire.
- [ ] **Pas de délai sur un appel d'outil** : un connecteur bloqué peut bloquer la tâche. À borner, ou à annuler proprement.
- [ ] **Deuxième source** : seul le registre officiel est utilisé. Smithery a été écarté pour l'installation (serveurs hébergés à distance).

## 5. Vérifications sur Windows

- [ ] **CI** : le job clippy échouait depuis `bf56b58`. Le clippy local passe ; à revérifier sur la CI.
- [ ] **Contrôle des fenêtres** : test réel (lister, activer, fermer, désigner par numéro après une question). Le test live existe, à relancer.
- [ ] **Claude Code** : chemins `.cmd` (`cmd /C`) et chemins avec lettre de lecteur, avec un appel réel accepté.
- [ ] **Reconnaissance vocale** : télécharger le modèle Whisper, tester une transcription réelle en FR et en EN.
- [ ] **OSINT** : résultats réels sur `example.com` (RDAP répond, crt.sh a expiré depuis cette machine).

## 6. Plugins

- [ ] Installation depuis un dépôt HTTPS réel. Aucun dépôt public n'existe encore.
- [ ] Appel réseau réussi d'un plugin WebAssembly vers un hôte déclaré (seul le refus est testé).
- [ ] Publier le SDK `sdk/nexus-plugin-sdk` sur crates.io.
- [ ] Catalogue public : un dépôt `index.json` avec un ou deux plugins.
- [ ] Permissions au-delà de `storage.local` et `network.fetch` (fichiers, processus, micro) : à concevoir.
- [ ] Les commandes de plugin ne sont plus déclenchées par texte : elles passent uniquement par le modèle, qui reçoit la liste des commandes installées. À vérifier avec un vrai plugin.

## 7. Améliorations d'intelligence et de confort

- [ ] Résumer les conversations en souvenirs (façon Hermes).
- [ ] Ne donner au modèle que les souvenirs pertinents, avec des embeddings locaux. Lève la limite de contexte.
- [ ] Demander confirmation quand le modèle hésite (confiance de sa réponse).
- [ ] Choisir la taille du modèle selon la tâche : petit pour les commandes, plus grand pour les questions ouvertes.
- [ ] Apprendre des corrections : « non, Firefox » enregistre l'association.
- [ ] Plan en étapes validé avant exécution, pour les demandes composées.
- [ ] Annuler la dernière action : renommage, déplacement, retour de la corbeille.
- [ ] Thème clair ou sombre qui suit celui de Windows.

## 8. Idées à trier

Idées de l'utilisateur, à discuter avant de les lancer :

- Connecteurs MCP proposés selon le profil (agenda, messagerie).
- Lecture et résumé de documents locaux (PDF, Word, notes).
- Rappels et minuteurs avec notification Windows.
- Actions sur le presse-papiers (traduire, résumer).
- Description de ce qui est à l'écran (modèle multimodal local).
- Lecture d'un calendrier local (ICS).
- Surveillance d'un dossier ou d'un fichier.
- Réponses parlées (synthèse vocale Windows).
- Historique des conversations, en option (aujourd'hui non conservé, volontairement).
- Mode discret : l'orbe seule, sans texte.
- Astuces contextuelles et tour guidé après la première conversation.

## 9. Hygiène et README

- [ ] Supprimer la sandbox `/root/Documents/nexus-e2e`, qui n'existe pas sur cette machine.
- [ ] Vider `src-tauri/target/debug/incremental` après chaque build (espace disque limité).
- [ ] Captures d'écran pour le README : à prendre sur l'application de bureau.
- [ ] Installateur public Windows (`pnpm tauri build` existe, reste à publier).
- [x] README refait, guide de développement dans `CONTRIBUTING.md`.

## 10. Décisions prises (pour mémoire)

- Tout passe par le modèle local, sans analyseur de texte (ADR-029). Remplace le « règles d'abord » de ADR-023 et la décision de garder les règles comme repli (ADR-025).
- Connecteurs MCP : un seul catalogue de confiance (registre officiel), 50 étoiles minimum, installation et appel après accord (ADR-027).
- Mémoire : enregistrement automatique par le modèle, sans limite ; oubli sur demande ; « tout oublier » avec confirmation (ADR-028 et ADR-029).
- Plugins avec code : WebAssembly, une fonction hôte, permissions approuvées (ADR-022). Plugins de données : sans code, empreinte SHA-256 approuvée (ADR-019 à ADR-021).
- Journal des commandes : SQLite, désactivé par défaut, texte seulement (ADR-018).
- Autorisations mémorisées : écriture dans un dossier et Claude Code pour un projet seulement ; suppression et fermeture jamais mémorisables (ADR-024). Vérifiées dans l'application.
- Conversation non conservée au redémarrage : voulu (vie privée).
