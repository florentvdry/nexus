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

## ADR-026 — Modèle local via Ollama, choisi et affiché par l'utilisateur

- **Choix** : le runtime est Ollama. Le parcours l'installe avec winget (paquet officiel `Ollama.Ollama`) après accord, puis le lance si besoin. NEXUS ne parle qu'à `127.0.0.1:11434`. Le parcours recommande un modèle selon la machine (Qwen2.5 1,5 B, 7 B ou 14 B, sous Apache 2.0 ; la taille 3 B est écartée à cause de sa licence), mais l'utilisateur voit le modèle utilisé dans les réglages et peut en choisir un autre parmi ceux qu'il a installés, ou aucun.
- **Pourquoi** : pas de compilation de llama.cpp dans NEXUS, téléchargements et mises à jour gérés par Ollama, et le choix du modèle reste visible. Les modèles sont téléchargés par `ollama pull`, lancé par l'utilisateur, pas par NEXUS.
- **Garanties** : la réponse est contrainte par un schéma (intentions connues ou `UNKNOWN`), validée avant usage, et jamais exécutée telle quelle. Sans modèle choisi, ou si Ollama ne répond pas, NEXUS reste sur les règles.
- **Conséquences** : `model_download.rs` n'est plus utilisé par le parcours (Ollama gère les téléchargements). La grammaire GBNF de `grammar.ts` est remplacée par le schéma imposé à Ollama.
- **Limites** : la première demande charge le modèle en mémoire et peut dépasser le délai de 3 s : la réponse arrive alors après le repli sur les règles. Les modèles candidats doivent être revérifiés à chaque nouvelle version.

## ADR-027 — Connecteurs MCP : un seul catalogue de confiance, installation après accord

- **Choix** : quand le modèle local reconnaît un service extérieur (`NEEDS_CONNECTOR`, p. ex. « envoie un message Discord »), NEXUS cherche un serveur MCP dans le **registre officiel** (`registry.modelcontextprotocol.io`), seule source. Seuls les paquets **npm lancés en stdio** sont proposés, et seulement si leur dépôt GitHub a au moins 50 étoiles (`MIN_STARS`). Les 5 meilleurs sont classés par étoiles.
- **Pourquoi un seul site** : le registre officiel est celui du protocole ; Smithery a été écarté comme source d'installation (ses serveurs sont hébergés à distance, avec leur propre clé) et son compteur d'utilisations ne suffit pas à juger un code. Aucune recherche sur le reste du web.
- **Garanties** :
  - Une installation ne peut viser qu'un identifiant trouvé par la dernière recherche (`Catalog::get`).
  - Un serveur n'est lancé qu'après « oui » de l'utilisateur (proposition, puis confirmation de chaque appel d'outil) ; l'outil choisi par le modèle doit exister dans la liste du serveur, ses arguments sont un objet.
  - Le nom du paquet et la version sont validés avant tout lancement ; `npx` ne reçoit que `paquet@version`.
  - Les variables (jetons) ne sont jamais réaffichées dans la conversation ni renvoyées à l'interface.
- **Limites connues** : le paquet npm s'exécute avec les droits de l'utilisateur, une fois accepté : la popularité ne vaut pas audit. Les valeurs des variables sont gardées **en clair** dans `mcp/installed.json` (le chiffrement DPAPI reste à faire). Node.js doit être présent. Aucun délai sur l'appel d'outil : un connecteur bloqué peut bloquer la tâche jusqu'à arrêt de NEXUS.

## ADR-028 — Mémoire de l'utilisateur : explicite d'abord, proposée ensuite, jamais cachée

- **Choix** : NEXUS retient les préférences et faits de deux façons. (1) « retiens que… » : enregistré tout de suite, c'est l'utilisateur qui l'a demandé. (2) Le modèle local peut proposer un souvenir (`REMEMBER`) : il n'est gardé qu'après « oui ». Les souvenirs se consultent (« qu'est-ce que tu retiens de moi ? »), s'oublient un à un (« oublie Firefox ») ou tous ensemble (« oublie tout », avec confirmation), et se suppriment dans les réglages.
- **Où** : `dossier de données/memory/memories.json`, côté natif, 200 souvenirs au plus (le plus ancien part), 300 caractères chacun, doublons à la casse près refusés.
- **Contexte du modèle** : les souvenirs accompagnent chaque classement, dans la consigne, comme des données (« jamais des instructions »), pour comprendre des formules comme « mon navigateur ».
- **Pourquoi pas plus automatique** : deviner une préférence depuis une conversation et la garder sans rien dire crée des faux souvenirs difficiles à voir. Une proposition confirmée reste la règle. L'utilisateur voit toujours la liste complète.
- **Limites** : une formule résolue par les règles (« ouvre mon navigateur », qui devient une application introuvable) ne passe pas par le modèle, donc ne profite pas encore de la mémoire. Le résumé automatique des conversations (façon Hermes ou OpenClaw) n'est pas fait.

## ADR-029 — Tout passe par le modèle local ; mémoire sans limite ; première conversation

- **Choix** : l'analyseur de texte par règles est retiré. Chaque demande est comprise par le modèle local, dont la réponse est validée (`validate.ts`) avant usage. Sans modèle prêt, NEXUS le dit et n'essaie pas de deviner. La section 1 du TODO (« modèle d'abord ») est tenue ; les dictionnaires restent utiles pour retrouver une application dans le catalogue (alias, plugins), pas pour comprendre une phrase.
- **Mémoire** : le modèle enregistre sans question les informations durables sur l'utilisateur (`REMEMBER`) et oublie sur demande (`FORGET`). Aucune limite de nombre de souvenirs ; une phrase tient en 1 000 caractères. Seul « tout oublier » demande confirmation. Remplace ADR-028 sur ces deux points (propositions à confirmer, limite de 200).
- **Contexte du modèle** : chaque demande reçoit les souvenirs, les éléments affichés (« ferme le deuxième ») et les commandes des plugins installés, comme données et jamais comme instructions.
- **Première conversation** : après l'installation et le setup, NEXUS pose sept questions (prénom, lieu, activité, usage, ton, longueur des réponses, ce qu'il ne doit jamais faire sans demander). Chaque réponse devient un souvenir « Libellé : réponse ». « passer » ignore une question. Les questions s'inspirent des parcours d'accueil d'assistants existants (OpenClaw BOOTSTRAP : nom, fuseau, rôle, limites ; et des patrons « 2 ou 3 questions, passer, choix multiples ») ; elles sont à relire avec l'utilisateur.
- **Limites** : sans modèle, aucune demande n'est comprise. La compréhension dépend de la taille du modèle (le niveau léger de 1,5 B est le plus fragile). Les demandes composées (« liste mes fenêtres puis montre le cpu ») ne sont plus découpées : le modèle renvoie une seule intention. Les références (« le deuxième ») passent par le contexte transmis au modèle, sans réécriture de texte.

## ADR-030 — Tâches programmées : relancées par NEXUS quand il tourne, par le même chemin que les demandes

- **Choix** : une demande « rappelle-moi demain à 9 h », « chaque lundi, résume mes actus » devient une tâche (une fois, chaque jour, chaque semaine). NEXUS vérifie la liste toutes les 30 secondes tant qu'il est ouvert, et relance la demande comme si elle était tapée : mêmes règles, mêmes confirmations.
- **Garde-fou** (règle relevée chez Hermes) : une tâche en cours d'exécution ne peut pas en créer d'autres.
- **Stockage** : `dossier de données/schedule/tasks.json`, écriture atomique, 100 tâches au plus, demande de 500 caractères au plus. Une liste invalide n'est jamais écrite.
- **Limites** : une tâche ne tourne que si NEXUS est ouvert. Une tâche manquée pendant la fermeture s'exécute une seule fois à la réouverture. Pas encore de démarrage avec Windows.

## ADR-031 — Fenêtres par demande : Wikipédia et Wikimedia Commons, images téléchargées côté natif, pas d'actualités sans source vérifiée

- **Choix** : « affiche une photo de X » ouvre une fenêtre image ; « qui est X ? » ouvre une fenêtre résumé. Sources : Wikimedia Commons (photos libres, avec auteur et licence) et Wikipédia fr (résumé, page d'origine). Vérifiées le 24/10/2026 par lecture réelle des réponses.
- **Images** : le natif télécharge la miniature (3 Mo au plus, hôtes `upload.wikimedia.org` et `thumb.wikimedia.org` seulement) et la renvoie en data URL. La politique de l'interface (`img-src 'self' data:`) n'est pas élargie.
- **Actualités** : aucun flux d'actualités n'a pu être vérifié (Le Monde, Radio France et France Info refusent la lecture depuis cet environnement). La demande « résume les actus » répond donc qu'il n'existe pas encore de source vérifiée, au lieu d'inventer une liste. À faire : que l'utilisateur choisisse ses médias, puis vérifier chaque flux avant de l'ajouter.
- **Limites** : résultat de la première page Commons seulement ; pas de cache ; pas encore de résumé produit par le modèle à partir de plusieurs sources.

## ADR-032 — Actualités : le flux « à la une » de Wikipédia fr, à défaut de médias

- **Choix** : « résume les actus » ouvre une fenêtre liste avec les éléments du jour du flux « à la une » de Wikipédia fr (`/api/rest_v1/feed/featured/AAAA/MM/JJ`), chacun avec sa page de référence. Si la journée n'est pas encore publiée, la veille est affichée, avec sa date.
- **Pourquoi** : les grands médias refusent la lecture depuis cet environnement, et une liste inventée serait pire. Ce flux est public, sans compte, et vérifié par lecture réelle le 24/10/2026.
- **Limites** : une sélection éditoriale de Wikipédia, pas la couverture complète de l'actualité. Les médias de l'utilisateur restent à ajouter, après vérification de chaque flux.

## ADR-033 — Routines : proposées après trois jours, programmées seulement après « oui »

- **Choix** : une demande faite sur trois jours distincts, à une heure stable (écart d'une heure au plus), devient une proposition : « Je le programme chaque jour à HH:MM ? ». Rien n'est programmé sans « oui ». La proposition arrive après la réponse, jamais à sa place.
- **Ce qui n'est pas compté** : les réponses, la mémoire, les tâches programmées elles-mêmes, l'aide, les connecteurs, et les demandes très courtes (moins de six caractères). Une demande lancée par une tâche programmée ne compte pas non plus.
- **Où** : seulement dans le stockage local du navigateur (`nexus.routines.v1`), avec la demande et les jours. Pas envoyé au modèle, pas de réseau. Un stockage bloqué désactive simplement la détection.
- **Limites** : une seule proposition par demande. Pas encore de moyen de désactiver la détection ; à ajouter dans les réglages avant de l'élargir.

## ADR-034 — Actualités : France 24 et Wikipédia, deux sources publiques vérifiées ; pas de recherche web à l'exécution

- **Choix** : la liste du jour combine les titres du flux RSS de France 24 (version française, `https://www.france24.com/fr/rss`, 24 éléments datés vérifiés le 24/10/2026) et le flux « à la une » de Wikipédia fr (ADR-032). Chaque élément garde sa page de référence ; la fenêtre cite les deux sources.
- **Hôtes autorisés à l'exécution** : `www.france24.com`, `fr.wikipedia.org`, `commons.wikimedia.org`, `upload.wikimedia.org`, `thumb.wikimedia.org`. Rien d'autre.
- **Recherche web** : elle est utilisée pour trouver des sources pendant le développement, pas par NEXUS à l'exécution. Une source n'entre dans NEXUS qu'après vérification et ton accord.
- **Non retenus pour l'instant** : BBC, 20 Minutes, RFI, Le Monde, Radio France. Leurs flux n'ont pas pu être lus depuis cet environnement (blocage de la lecture), ou ne sont pas encore vérifiés. À reprendre une fois que tu auras choisi les médias.
- **Limites** : une seule source d'actualité française vérifiée ; la sélection de France 24 reste celle de sa rédaction.

## ADR-035 — Actualités sur tout le web, tâches visibles, démarrage avec Windows (sur demande)

- **Actualités** : la liste du jour vient de la recherche d'actualités de Google (`news.google.com/rss`, flux public sans clé, vérifié le 24/10/2026). Avec un sujet (« actus sur Macron »), la recherche porte sur ce sujet ; sans sujet, ce sont les titres du moment. Plus de liste de médias fixée à l'avance. Les liens passent par la redirection de Google, qui reste la page de référence.
- **Hôtes autorisés à l'exécution** : `news.google.com`, `www.france24.com`, `fr.wikipedia.org`, `commons.wikimedia.org`, `upload.wikimedia.org`, `thumb.wikimedia.org`.
- **Tâches programmées** : « quelles tâches sont programmées ? » ouvre un tableau (demande, récurrence, prochaine exécution), sans passer par le texte d'une liste.
- **Démarrage avec Windows** : une case dans les réglages, qui écrit ou retire la valeur `NEXUS` dans `HKCU\...\Run` (clé de l'utilisateur, sans droits administrateur). Rien n'est écrit à l'installation. Le chemin doit être sans guillemet.
- **Reste** : `web_news` et `web_headlines` (Wikipédia et France 24) ne sont plus utilisés par les actualités ; à retirer ou à garder pour un usage futur.

## ADR-036 — Alertes proactives : disque et mémoire, une fois par alerte

- **Choix** : toutes les cinq minutes tant que NEXUS tourne, la machine est lue (même lecture que « état de la machine »). Un disque libre sous 10 % ou une mémoire utilisée au-delà de 90 % produit une alerte, annoncée une seule fois tant qu'elle dure.
- **Pourquoi** : premier pas du point 5 des fonctionnalités Jarvis, sans compte, sans réseau, sans accord supplémentaire (lecture seule de la machine).
- **Limites** : pas de batterie ni de mises à jour pour l'instant (API Windows à ajouter avec accord). Les seuils sont fixes ; à rendre réglables.

## ADR-037 — Batterie : lecture seule, alerte sous 15 % débranchée

- **Choix** : l'état de la batterie est lu en lecture seule (`GetSystemPowerStatus`, Windows) et alimente les alertes proactives. Une batterie faible, non branchée, sous 15 % produit une alerte, une seule fois tant qu'elle dure. Un poste fixe n'a pas d'alerte batterie.
- **Pourquoi** : lecture sans effet sur la machine, pas de compte, pas de réseau.
- **Limites** : les mises à jour Windows restent à faire (interrogation du système de mise à jour, à faire avec ton accord).

## ADR-038 — Agenda en lecture seule, brouillons de messages sans envoi, accès direct au planning

- **Agenda** : NEXUS lit un fichier .ics que tu désignes dans les réglages (chemin saisi, seule l'extension .ics est acceptée, 2 Mo au plus). « Qu'est-ce que j'ai aujourd'hui ? » ouvre un tableau des rendez-vous du jour. Les heures sont lues dans le fuseau du fichier quand il est local, et en UTC quand il finit par Z. Les récurrences ne sont pas encore développées.
- **Brouillons** : « écris à X que… » ouvre une fenêtre avec le texte et un bouton « Copier ». NEXUS n'envoie jamais un message : c'est toujours toi qui l'envoies.
- **Accès direct** : un bouton « Planning » dans la barre ouvre la liste des tâches programmées.
- **Limites** : pas de compte de messagerie ni d'agenda en ligne (il faudra un accord et une source) ; pas de récurrence d'agenda ; le modèle léger peut se tromper sur l'intention.

## ADR-039 — Vision de l'écran : sur demande, confirmée, une seule capture, lue par un modèle local

- **Déclencheur** : une question sur l'écran (« qu'est-ce qui est affiché ? »). Jamais de capture en arrière-plan.
- **Confirmation** : NEXUS dit ce qu'il va faire et demande « oui » ou « non ». Une autre réponse abandonne la question.
- **Capture** : écran principal, GDI, réduit à 1024 px de large, encodé en PNG en mémoire. Rien n'est enregistré sur le disque. La capture est affichée dans une fenêtre « Ce que NEXUS a vu », pour que tu voies exactement ce qui a été lu.
- **Lecture** : un modèle de vision installé sur ce poste (noms reconnus : qwen2.5vl, llava, minicpm-v, moondream, gemma3). Aucun modèle de vision n'est installé sur cette machine : NEXUS l'indique et donne la commande, sans télécharger lui-même.
- **Limites** : vérifiée par une capture réelle (PNG décodé), mais la réponse du modèle de vision n'a pas été testée faute de modèle. Pas de capture multi-écrans ; l'écran principal seulement.
- **Écoute permanente (mot de réveil)** : non construite. Elle devra demander ton consentement explicite avant d'être activée ; elle n'est pas en place.

## ADR-040 — Retours de test : noms de dossiers français, réponses vérifiées au premier lancement, fiche de compétences, NVIDIA NIM en option

- **Dossiers** : « bureau », « téléchargements », « documents », « images » (sans accents, sans casse) sont reconnus comme les dossiers anglais. Lecture seule, sans demande d'autorisation supplémentaire.
- **Premier lancement** : une salutation (« salut », « ok », « oui ») n'est jamais gardée comme prénom ni comme préférence. La question est reposée avec un indice. « passer » ignore une question.
- **Fiche de compétences** (`src-tauri/src/skills/nexus.md`) : les règles et exemples par intention, lus par le modèle local avec sa consigne. « Tu sais faire quoi ? » donne l'aide, et non l'état du processeur.
- **Chargement** : l'installation automatique affiche l'orbe et le libellé « Chargement… » dès son démarrage.
- **NVIDIA NIM (option)** : désactivé par défaut. Quand il est activé avec une clé, les demandes sont envoyées à `integrate.api.nvidia.com` (seul hôte autorisé pour ce service) ; sans clé, en cas d'échec ou de quota dépassé, le modèle local sur ce poste répond. La clé est gardée dans le stockage local du navigateur, en clair ; à déplacer vers le stockage natif chiffré.
- **Limites** : NIM n'a pas été testé avec une vraie clé (aucune n'est enregistrée). Le nom de modèle par défaut est à vérifier sur le catalogue NVIDIA.

## ADR-041 — Questions ouvertes sur le web (sans clé), Planning complet, lecture vocale des réponses, Edge

- **Recherche générale** : DuckDuckGo, version HTML, sans clé ni compte. Le choix est le plus simple à maintenir ; il dépend d'un service tiers qui peut changer sa mise en page ou limiter les requêtes. Une clé Brave Search ou un SearXNG auto-hébergé restent possibles si ce service devient insuffisant.
- **Lecture des pages** : 3 résultats au plus, HTTP ou HTTPS seulement, 1 Mo au plus par page, 6000 caractères de texte. Les adresses sans nom de domaine public, les ports, les identifiants et les adresses locales ou privées sont refusés. Une redirection vers une adresse privée n'est pas bloquée (voir `docs/ANALYSE-CAUSES.md`).
- **Réponse** : le modèle local répond à partir de ces sources seules, en JSON, et ses sources sont listées. Les pages sont traitées comme des données : une consigne écrite dans une page ne change pas la tâche. Les réponses sont en français.
- **Planning** : le bouton « Planning » ouvre un panneau avec toutes les tâches programmées et un bouton « Annuler » pour chacune.
- **Lecture vocale** : le bouton « Répondre à voix haute » lit toutes les réponses (mode `always`). Le mode `voice`, qui ne lit que les commandes vocales, reste disponible dans les réglages vocaux.
- **Edge** : ajouté au catalogue (Rust et TypeScript). « Lance X » est une ouverture d'application ; `AGENT_RUN` ne sert qu'aux demandes explicites d'agent.
- **Limites** : les résultats de recherche peuvent être des sites commerciaux peu fiables, et le modèle ne les classe pas encore. La réponse est lente sur un poste sans GPU (plusieurs dizaines de secondes avec un modèle 7 B). Pas de recherche d'images ni de vidéos.

## ADR-042 — Applications : aucun catalogue, un scan du PC à la demande

- **Choix** : NEXUS ne tient plus de liste d'applications. Il cherche le nom demandé sur le PC : d'abord la liste des applications du menu Démarrer (`Get-StartApps`, avec le nom affiché par Windows, y compris les applications du Store), puis les raccourcis du menu Démarrer, les clés « App Paths » du registre, et les exécutables sous Program Files et AppData\Local\Programs.
- **Lancement** : une application du Store ou un raccourci passe par l'explorateur (`shell:AppsFolder\<identifiant>` ou le fichier .lnk) ; un exécutable est lancé directement, sans shell. Le frontend ne transmet qu'un nom, jamais une commande ni un chemin.
- **Correspondance** : mots entiers, sans casse ni accent, mots vides retirés (« le », « the »). Un nom exact passe avant un nom qui le contient ; un raccourci passe avant le même programme dans la liste du Store.
- **Cache** : le scan est gardé dix minutes ; une application absente est cherchée une seconde fois dans un scan neuf.
- **Alias** : un paquet `aliases` peut dire un nom autrement (« dis cord » -> « Discord »). Il ne peut plus viser une liste : son identifiant est seulement un nom à chercher.
- **Vérifié** : le scan trouve Microsoft Edge, Discord, Google Chrome, Bloc-notes, Calculatrice, Paint et l'Explorateur sur ce PC, et ne trouve rien pour un nom inventé. Le lancement n'a pas été testé sur ce PC, pour ne pas ouvrir d'application sans demande.
- **Limites** : les applications ni dans le menu Démarrer, ni inscrites au registre, ni dans les dossiers scannés ne sont pas trouvées. Le nom doit être celui que Windows affiche (ou un alias). Les noms de la liste viennent de Windows, donc varient selon la langue du système.
