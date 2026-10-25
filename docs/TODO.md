# À faire

État au 25/10/2026, commit `3a2eeb9` sur `main`. `[x]` : livré. `[~]` : partiel. `[ ]` : à faire. Les décisions qui ont changé sont signalées en tête de leur ADR dans `docs/DECISIONS.md` ; la compréhension passe par le modèle local (ADR-029).

## 0. Feuille de route de la nuit (amélioration continue)

Cap : une demande = une fenêtre ; tâches du quotidien simplifiées ; NEXUS comme couche d'intelligence sur le PC.
Relevé des usages et des assistants : `docs/RESEARCH.md`.

Ordre, sans commit ni test sur le PC :
1. [x] **Tâches programmées** (ADR-030, testées, non vérifiées dans l'application) : « rappelle-moi demain à 9 h », « chaque lundi, résume mes actus ». Une tâche planifiée ne peut pas en planifier d'autres (règle Hermes).
2. [x] **Fenêtres par demande** (ADR-031) : photo (Wikimedia Commons) et fiche sujet (Wikipédia), testées. **Actualités** : recherche sur tout le web (Google Actualités), avec sujet (ADR-035). Vérifiée dans l'application le 24/10 (photo, fiche, actualités, tâches).
3. [x] **Date et heure dans le contexte du modèle**, pour comprendre « demain », « lundi », « ce soir ».
4. [x] **Mémoire des routines** (ADR-033) : proposition après trois jours à la même heure, programmée seulement après « oui ». Désactivable dans les réglages (section Mémoire).

Accessibilité : réglage « texte plus grand » (section Accessibilité des réglages), mouvement réduit déjà géré. Clavier : Échap ferme la dernière fenêtre ordinaire (jamais une confirmation). Contraste audité : tous les textes passent WCAG AA (4,5) sur le fond sombre, à vérifier à l'écran.

État au 24/10 : tâches programmées, photo, fiche sujet, actualités du jour, retour immédiat et messages d'aide sont faits et testés. Rien n'est vérifié dans l'application lancée : à faire avec ton accord.

## 0bis. Fonctionnalités « Jarvis » (demandées le 24/10)

Chaque point : état, et ce qu'il faut pour le faire. « Accord » = ton accord explicite requis.

1. [ ] **Écoute permanente avec mot de réveil** : répondre à « Jarvis » sans geste. Demande un micro ouvert en continu et une détection de mot de réveil locale. Accord (micro) requis.
2. [~] **Voix naturelle** : voix neurale Piper, voix française installée sur accord (ADR-043, ADR-044), voix Windows en repli. Reste : écouter la qualité sur la machine, installer la voix anglaise après accord.
3. [x] **Vision de l'écran** (ADR-039) : question confirmée, capture de l'écran principal, lecture par un modèle de vision local. Testée de bout en bout (commit `ebb8928`).
4. [ ] **Contrôle des applications** : remplir et enchaîner des actions dans les logiciels, sans API. Demande une automatisation d'interface, étape par étape, avec confirmation.
5. [~] **Alertes proactives** : disque presque plein, mémoire saturée. **Fait en partie** (ADR-036, ADR-037) : disque, mémoire, batterie. Mises à jour Windows restent à faire.
6. [~] **Agenda et messages** : **fait en partie** (ADR-038) : agenda du jour depuis un fichier .ics désigné, brouillons à copier (rien n'est envoyé). Reste : comptes de messagerie et d'agenda en ligne, avec accord.
7. [ ] **Maison connectée** : lumières, prises, thermostat. Demande les appareils et leur protocole. Accord requis.
8. [ ] **Équipe d'agents** : plusieurs tâches en parallèle, chacune confiée à un agent qui rend compte. Demande un ordonnanceur et des garde-fous par agent.
9. [ ] **Auto-amélioration** : écrire ses propres outils quand il en manque un, avec ton accord à chaque ajout. Risque élevé : à cadrer avant.
10. [ ] **Interface cohérente** : un fil de conversation, des fenêtres au bon moment, une présence visuelle permanente (l'orbe). Partiellement en place.

Hors périmètre : la reconnaissance faciale de personnes non volontaires et le suivi de leurs déplacements.

## Retours de test (24/10, ADR-040)

- [x] Dossiers français, premier lancement qui refuse les salutations, fiche de compétences, libellé « Chargement ».
- [~] NVIDIA NIM en option : écrit et testé hors ligne ; reste à tester avec une vraie clé et à déplacer la clé vers le stockage natif chiffré.

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
- [ ] **Voix naturelle (Piper)** : installer la voix française depuis les réglages, l'écouter, vérifier le repli sur la voix Windows (anglais, ou voix absente).
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
- Rappels et minuteurs avec notification Windows (rappels programmés : ADR-030 ; notification Windows à vérifier).
- Actions sur le presse-papiers (traduire, résumer).
- ~~Description de ce qui est à l'écran (modèle multimodal local).~~ Fait : ADR-039.
- ~~Lecture d'un calendrier local (ICS).~~ Fait : ADR-038.
- Surveillance d'un dossier ou d'un fichier.
- ~~Réponses parlées (synthèse vocale Windows).~~ Fait : voix neurale locale et repli Windows (ADR-041 à ADR-044).
- Historique des conversations, en option (aujourd'hui non conservé, volontairement).
- Mode discret : l'orbe seule, sans texte.
- Astuces contextuelles et tour guidé après la première conversation.

## 9. Hygiène et README

- [ ] Supprimer la sandbox `/root/Documents/nexus-e2e`, qui n'existe pas sur cette machine.
- [ ] Vider `src-tauri/target/debug/incremental` après chaque build (espace disque limité).
- [ ] Captures d'écran pour le README : à prendre sur l'application de bureau.
- [ ] Installateur public Windows (`pnpm tauri build` existe, reste à publier).
- [x] README refait, guide de développement dans `CONTRIBUTING.md`.
- [ ] Sécurité : une redirection ou un nom de domaine qui pointe vers une adresse privée n'est pas bloqué (la vérification porte sur l'adresse écrite). Résoudre le nom avant la requête (voir `docs/DECISIONS.md`, « Lecture des pages »).
- [ ] Banc de tests de compréhension : ajouter à `src/core/language-model/benchmark.ts` les cas « lance X », « tu connais X », « elle », « ça », à rejouer sur le modèle réel.
- [ ] Recherche web : préférer les sites officiels et Wikipédia, et dire quand une source est un site commercial.

## 10. Décisions prises (pour mémoire)

- Tout passe par le modèle local, sans analyseur de texte (ADR-029). Remplace le « règles d'abord » de ADR-023 et la décision de garder les règles comme repli (ADR-025).
- Connecteurs MCP : un seul catalogue de confiance (registre officiel), 50 étoiles minimum, installation et appel après accord (ADR-027).
- Mémoire : enregistrement automatique par le modèle, sans limite ; oubli sur demande ; « tout oublier » avec confirmation (ADR-028 et ADR-029).
- Plugins avec code : WebAssembly, une fonction hôte, permissions approuvées (ADR-022). Plugins de données : sans code, empreinte SHA-256 approuvée (ADR-019 à ADR-021).
- Journal des commandes : SQLite, désactivé par défaut, texte seulement (ADR-018).
- Autorisations mémorisées : écriture dans un dossier et Claude Code pour un projet seulement ; suppression et fermeture jamais mémorisables (ADR-024). Vérifiées dans l'application.
- Conversation non conservée au redémarrage : voulu (vie privée).
