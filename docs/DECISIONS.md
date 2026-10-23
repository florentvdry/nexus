# Décisions techniques

## ADR-001 — Tauri 2 plutôt qu'Electron

Tauri utilise le WebView2 déjà présent sur Windows 10 et 11 : binaire léger, démarrage rapide,
accès natif en Rust. Le besoin de consommation mémoire réduite (objectif du brief, section 16)
l'emporte sur la familiarité d'Electron.

## ADR-002 — Core Engine en TypeScript pur

La logique de commande, de tâches et de placement ne dépend ni de React ni de Tauri. Elle se teste
en Node sans navigateur. Les contraintes de performance ne justifient pas encore un passage à Rust.

## ADR-003 — Classification par règles en phase 1

Les commandes de la phase 1 sont courtes et bien délimitées. Des expressions régulières et des
dictionnaires suffisent, sans coût ni latence. Un classificateur local viendra en phase 5, si les
règles ne couvrent plus les besoins.

## ADR-004 — Catalogue fermé pour le lancement d'applications

Le frontend envoie un identifiant (`discord`), jamais une commande. Cela évite l'exécution de
commandes arbitraires à partir d'un texte, y compris un texte qui viendrait de sources externes.
Ajouter une application revient à ajouter une entrée dans `apps.rs` et dans `dictionaries.ts`.

## ADR-005 — Aucune donnée simulée en mode navigateur

Hors application de bureau, le backend natif est remplacé par un adaptateur qui échoue
explicitement. Les données de démonstration n'existent que dans les tests, et ils le signalent.

## ADR-006 — Licence MIT

Compatible avec les dépendances actuelles (Tauri, React, sysinfo, Vite, Vitest sont MIT ou
Apache-2.0). Les composants vocaux de la phase 2 devront être vérifiés individuellement.

## ADR-007 — Reconnaissance vocale : whisper.cpp et Silero VAD, en local

- **Choix** : whisper.cpp (MIT) via `whisper-rs`, avec Silero VAD v5/v6 (MIT) pour détecter la parole.
- **Pourquoi** : hors ligne, multilingue, sans clé d'API, et le micro ne quitte jamais la machine.
- **Écartés** :
  - API de reconnaissance du navigateur (`webkitSpeechRecognition`) : Chromium envoie l'audio à un service en ligne.
  - Vosk : son modèle français n'était pas accessible depuis les registres autorisés, et ses modèles ne sont pas sur PyPI ou npm.
- **Conséquence** : le modèle Whisper doit être téléchargé par l'utilisateur ou par une étape explicite. Il n'est pas embarqué (148 Mo pour `base`).

## ADR-008 — Synthèse vocale : voix du système, Piper plus tard

- **Choix en phase 2** : API Web Speech (`speechSynthesis`). Sous WebView2 sur Windows, elle utilise les voix SAPI installées, hors ligne et sans téléchargement.
- **Pourquoi pas Piper maintenant** : ses voix sont hébergées sur Hugging Face (inaccessible ici), et sa phonémisation repose sur espeak-ng, sous GPL-3. Intégrer espeak-ng dans l'installateur obligerait à publier le produit sous GPL.
- **Suite** : Piper reste un fournisseur possible derrière `SpeechOutput`, en option, à installer par l'utilisateur. Sa licence sera revue avant tout ajout.

## ADR-009 — Variante du VAD et renommage des nœuds ONNX

- **Choix** : `silero_vad_openvino_16k.onnx` (Silero VAD v6.2.3), sans opérateur `If`, avec les nœuds renommés pour être acceptés par tract.
- **Pourquoi** : la variante `silero_vad_op18_ifless` contient encore un `If` que tract ne sait pas planifier. La variante `16k_openvino` s'exécute, et ses probabilités concordent avec onnxruntime sur les fixtures.
- **Détail** : le modèle est inclus dans le binaire (`include_bytes!`, environ 1,3 Mo), pour éviter de dépendre d'un chemin de ressources à l'exécution.

## ADR-010 — Raccourci global enregistré côté Rust

- **Choix** : `tauri-plugin-global-shortcut` 2.x, enregistré dans `lib.rs`. Le raccourci émet `voice://toggle` vers l'interface.
- **Pourquoi** : aucune permission JavaScript à accorder, et un échec d'enregistrement (raccourci déjà pris) est journalisé sans bloquer le démarrage.

## ADR-011 — Connecteurs exécutés dans un processus séparé

- **Choix** : un binaire `nexus-worker` reçoit une requête JSON sur l'entrée standard et renvoie un rapport sur la sortie standard. Le backend l'arrête si le délai est dépassé.
- **Pourquoi** : un connecteur peut être bloqué, planter, ou produire une sortie énorme. Un processus séparé protège l'application et borne les ressources, sans dépendre d'une technologie de bac à sable par système.
- **Limite** : ce n'est pas un bac à sable de sécurité complet (pas de restriction des appels système). Le worker n'exécute que du code de NEXUS, et son entrée est validée. Un bac à sable par système (AppContainer sous Windows) viendra si des plugins tiers sont acceptés.

## ADR-012 — Vérification TLS par le magasin de l'OS

- **Choix** : `ureq` avec `platform-verifier` au lieu des racines intégrées de `rustls`.
- **Pourquoi** : sous Windows, les proxys d'entreprise installent une autorité de certification dans le magasin du système. Les racines intégrées la refuseraient, et l'analyse échouerait sans raison visible pour l'utilisateur.

## ADR-013 — Périmètre OSINT de la phase 3

- **Inclus** : DNS, certificats publics, pseudo sur trois plateformes publiques, analyse locale de fichier.
- **Exclus** : emails, recherches intrusives, contournement de protections, fusion automatique d'identités. Chaque exclusion est refusée par une réponse explicite.
- **Statuts** : une correspondance de pseudo reste « possible », jamais « vérifiée ». Un 404 reste « introuvable », jamais « absent ».

## ADR-014 — Confirmation exigée par le backend natif

- **Choix** : toute action sensible (écriture, suppression, lancement de Claude Code) appelle `permissions::confirm` dans Rust avant d'agir. Le broker garde les demandes en attente, les expire après 120 secondes et refuse toute réponse inconnue.
- **Pourquoi** : une confirmation uniquement dans l'interface peut être contournée par un appel direct à la commande, ou par un plugin qui appelle le pont natif. Placer la garantie dans le backend la rend indépendante de l'appelant.
- **Limite** : le backend ne sait pas encore quel plugin appelle. Voir `docs/PERMISSIONS.md`.

## ADR-015 — Racines de fichiers : dossiers utilisateur, jamais le dossier personnel

- **Choix** : les seules racines sont les sous-dossiers canoniques de Documents, Téléchargements, Bureau et Images. Le dossier personnel n'est jamais une racine.
- **Pourquoi** : une première version retenait le dossier personnel par repli de la bibliothèque `dirs`, et une recherche remontait des fichiers de configuration (`~/.claude`). Une racine trop large rend la confirmation inutile.
- **Conséquence** : des fichiers rangés directement dans le dossier personnel ne sont pas accessibles. C'est voulu.

## ADR-017 — Identité de l'appelant vérifiée côté natif

- **Choix** : chaque commande native reçoit `caller`. Le backend compare la permission demandée à la table `grants.rs`, tenue synchronisée avec les `plugin.json` par un test. Seul `core` peut répondre à une confirmation.
- **Pourquoi** : sans identité, une permission accordée à un plugin serait accordée à toute la fenêtre. Un plugin pourrait aussi approuver sa propre confirmation.
- **Limite** : l'identifiant est fourni par la fenêtre. Il ne résiste pas à du code hostile qui utiliserait directement l'API Tauri. Un isolement réel viendra avec le chargement de plugins tiers.

## ADR-018 — Journal des commandes : SQLite, opt-in, texte seulement

- **Choix** : un fichier SQLite dans le dossier de données de l'application. Désactivé par défaut. 500 commandes au plus, texte tronqué à 300 caractères, type de commande validé (majuscules et `_`).
- **Pourquoi** : l'historique est utile, mais une commande peut contenir des chemins personnels. Le choix par défaut doit donc protéger la vie privée. Le natif décide de l'enregistrement, pas l'interface : un désaccord entre les deux ne peut pas écrire de données.
- **Exclus** : résultats, contenu des fichiers, réponses de Claude Code.
- **Conséquence** : la base est créée vide au démarrage, sans aucune donnée personnelle, même si le journal reste désactivé.

## ADR-019 — Plugins de données d'abord, sans code

- **Choix** : la version 1 n'accepte que des paquets de données (`language`, `aliases`). Les types avec code sont refusés.
- **Pourquoi** : un plugin avec code, exécuté dans la fenêtre principale, aurait les mêmes droits que l'interface. Tant
  qu'un isolement réel n'existe pas (WebAssembly ou iframe), il ne doit pas exister. Les données seules suffisent à
  étendre la compréhension, sans risque.
- **Conséquence** : un paquet ne peut pas ajouter d'action, seulement des mots et des alias vers le catalogue existant.

## ADR-020 — Approbation par empreinte et lock

- **Choix** : l'utilisateur approuve une empreinte SHA-256 de tous les fichiers, pas un nom ou une version. Le natif
  recalcule l'empreinte juste avant d'installer. Le lock garde le commit, l'empreinte et la date d'approbation.
- **Pourquoi** : un auteur peut republier une version sous le même numéro. Une empreinte garantit que l'utilisateur
  valide exactement ce qu'il installe, et qu'une modification ultérieure désactive le plugin.
- **Limite** : l'empreinte ne prouve pas l'identité de l'auteur. Une signature viendra plus tard.

## ADR-021 — Installation depuis Git : HTTPS, sans script

- **Choix** : seules les adresses HTTPS sans identifiants sont clonées (`--depth 1`, sans invite, délai de 120 s). Aucun
  hook ni script n'est exécuté. Les dossiers locaux sont copiés, sans lien symbolique.
- **Pourquoi** : c'est le modèle sûr constaté chez Omarchy, sans son absence de contrôle. Un dépôt ne peut rien exécuter
  pendant l'installation.

## ADR-022 — Plugins avec code : WebAssembly, avec une seule fonction hôte

- **Choix** : un plugin `action` est un module WebAssembly exécuté par wasmtime 50. Il n'importe que `nexus.host_call` et chaque opération est vérifiée contre les permissions approuvées dans le lock.
- **Pourquoi** : un plugin Rust reste possible, car Rust compile vers WebAssembly. Le choix porte sur le bac à sable. Une DLL chargée dans NEXUS aurait les droits de l'application. Un processus séparé n'a pas de contrôle fin des permissions sans bac à sable système, complexe sous Windows. Une iframe JavaScript offre une garantie plus faible.
- **Conséquence** : le SDK Rust (`sdk/nexus-plugin-sdk`) et un exemple complet. Les autres langages peuvent cibler le même contrat.
- **Coût** : wasmtime exige Rust 1.97 (la version minimale du projet passe à 1.97). Le module est compilé à la vérification et mis en cache par empreinte.
- **Limites** : pas de bibliothèque de plugins publique ; les types `source`, `document`, `agent` et `speech` restent réservés ; l'accès aux fichiers et au micro n'est pas ouvert.

## ADR-023 — Compréhension plus souple, contexte et questions, sans modèle de langage

- **Choix** : la compréhension reste déterministe, enrichie de trois mécanismes. (1) Politesse et formules de question retirées avant classification, demandes enchaînées par « puis / ensuite / then » (trois au maximum), fautes de frappe sur les noms d'application (une seule suggestion, jamais un choix ambigu). (2) Une mémoire de conversation : les éléments d'une liste (fichiers trouvés, fenêtres) deviennent des références (« le deuxième », « ferme-le »), réécrites en commandes explicites avant la compréhension. (3) Des questions : quand une demande est ambiguë, NEXUS demande lequel, et la réponse (numéro, ordinal, libellé, « oui », « non ») exécute l'option choisie.
- **Pourquoi** : les règles couvrent mal les formulations naturelles, mais un modèle de langage enverrait les demandes hors de la machine et exigerait une clé et une connexion. La mémoire et les questions donnent l'impression de comprendre sans rien quitter de l'ordinateur, et sans déplacer la décision de sécurité.
- **Garanties** : une référence réécrite passe par les mêmes confirmations que la commande saisie. Un pronom qui ne désigne pas un seul élément pose une question au lieu de deviner. « ouvre la calculatrice » n'est jamais réécrite, même après une liste.
- **Limites** : les formulations hors du vocabulaire restent non comprises. Un modèle de langage local ou distant reste une décision à part, à prendre avec l'utilisateur (confidentialité, clé, connexion).

## ADR-016 — Claude Code via le CLI officiel, en mode non interactif

- **Choix** : NEXUS lance le CLI `claude` installé par l'utilisateur, avec `-p --output-format stream-json`, la demande sur l'entrée standard et un budget plafonné. Il ne lit pas les identifiants, ne modifie pas la configuration et ne passe pas `--dangerously-skip-permissions`.
- **Pourquoi** : c'est l'interface officielle. Elle respecte l'authentification locale et les permissions de Claude Code, comme le demande le cahier des charges.
- **Limite** : le format `stream-json` peut évoluer ; le test sur un enregistrement réel et le test réel (`--ignored`) doivent être relancés à chaque mise à jour du CLI.

## ADR-024 — Autorisations mémorisées : par dossier ou projet, jamais pour la suppression

- **Choix** : « toujours autoriser » couvre une portée précise : un dossier (écriture de fichier, sous-dossiers compris) ou un projet (Claude Code). Les règles sont stockées côté natif, révocables une à une, et chaque approbation automatique est annoncée et journalisée.
- **Pourquoi** : les actions répétitives (renommer des fichiers d'un même dossier) ne doivent pas exiger une question à chaque fois. Mais une règle large, ou une règle sur une action irréversible, retirerait l'essentiel de la protection. La portée bornée et l'exclusion de la suppression, de la fermeture de fenêtres et des plugins gardent la confirmation là où elle compte.
- **Garanties** : la décision reste dans le natif, comme pour la confirmation (ADR-014). Une règle ne peut pas être créée par un plugin ni lue par lui. Un refus ne crée jamais de règle. Un chemin avec `..` ou un dossier voisin au nom commençant pareil n'est pas couvert.
- **Conséquence** : la carte de confirmation porte une case et une portée ; les réglages listent les règles avec leur révocation et le journal des approbations automatiques.
- **Limites** : le journal des approbations automatiques est gardé en mémoire pour la session ; seules les règles survivent au redémarrage. La vérification de bout en bout dans l'application de bureau (Windows) reste à faire.

## ADR-025 — Modèle de langage local : activation explicite, règles conservées

- **Choix** : le modèle n'est téléchargé qu'après une activation explicite de la compréhension avancée, avec accord et taille affichés (recommandation du TODO, retenue). Les règles restent la compréhension principale et le validateur : le modèle n'intervient que quand `parseIntent` renvoie `UNKNOWN`, et sa réponse n'est retenue qu'après validation de sa forme, dans le délai (3 s) et sans jamais produire `UNKNOWN` ni `UNSUPPORTED`.
- **Pourquoi** : un téléchargement au premier lancement imposerait plusieurs Go sans demande. Garder les règles évite qu'une panne du modèle rende NEXUS inutilisable, et garde les commandes simples instantanées et sans erreur possible du modèle.
- **Garanties** : rien ne quitte la machine ; le modèle ne fait que classer la demande en intention connue ; les confirmations, racines autorisées et permissions restent appliquées par le moteur et le natif, comme pour les règles.
- **Limites** : le choix des modèles candidats reste ouvert : licence et support du français à vérifier avant d'en proposer un. Les tailles des niveaux sont des ordres de grandeur. Le runtime llama.cpp et le téléchargement avec somme de contrôle ne sont pas encore implémentés côté natif.
