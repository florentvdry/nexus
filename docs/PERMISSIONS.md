# Permissions

NEXUS n'a aucun droit par défaut. Chaque capacité déclare les permissions qu'elle exige, et le
registre refuse toute exécution si une permission n'est pas accordée.

## Niveaux d'exécution

| Niveau | Comportement | Exemples |
|---|---|---|
| `automatic` | Exécuté sans demande, action simple et réversible | Ouvrir une application, afficher les ressources système |
| `confirmation` | Demande une confirmation explicite avant l'action | Renommer, déplacer, supprimer un fichier ; lancer Claude Code (phase 4) |
| `restricted` | Refusé par défaut, aucune exception | Élévation de privilèges, accès aux secrets |

## Permissions de la phase 1

| Permission | Niveau | Accordée par défaut | Utilisée par |
|---|---|---|---|
| `system.read` | automatic | oui | `system.info` |
| `process.launch` | automatic | oui | `apps.launch` |
| `osint.passive` | automatic | oui | `osint.domain`, `osint.username` (sources publiques, sans connexion) |
| `file.read` | automatic | oui | `document.inspect` (fichier désigné explicitement par l'utilisateur) |

Les connecteurs OSINT de la phase 3 ne font que des lectures publiques et passives. Toute action intrusive
(scan de ports, tentative de connexion, contournement de protection) relève du niveau `restricted` et reste
exclue. Une source qui refuse l'accès est signalée ; le connecteur ne cherche pas à la contourner.

Le niveau de chaque permission est défini dans `src/core/capabilities/types.ts` (`PERMISSION_TIERS`).
Une permission `confirmation` est accordée au registre, mais elle ne suffit pas à agir : le backend Rust
demande lui-même la confirmation (voir la phase 4). Une permission `restricted` est refusée sans exception.

## Garanties techniques (phase 1)

- Le lancement d'application n'accepte qu'un nom, cherché sur le PC par le scan (aucun catalogue, ADR-042) ; seule une application trouvée peut être lancée
  (`src-tauri/src/plugins/actions/apps.rs`). Aucune chaîne venant de l'interface n'est exécutée comme commande.
- Aucune élévation de privilèges n'est demandée ni tentée.
- Le processus lancé est détaché : NEXUS ne le surveille pas et n'injecte rien dans lui.
- Aucun appel réseau n'est effectué par les capacités de la phase 1.

## Microphone (phase 2)

| Élément | Règle |
|---|---|
| Activation | Uniquement sur action : clic sur le micro ou `Ctrl+Alt+Espace`. Jamais au démarrage. |
| Désactivation | Le réglage « Fonctions vocales activées » arrête l'écoute et bloque toute nouvelle session. |
| Indication | L'orbe passe en écoute ou en reconnaissance, et le bouton micro reste enfoncé. |
| Destination | Aucune. Le VAD et Whisper tournent localement. Aucun fichier audio n'est écrit sur le disque. |
| Matériel | Le micro par défaut du système est utilisé. Aucune sélection de périphérique en phase 2. |

Le micro n'est pas une permission du registre de capacités : c'est une fonction de l'interface, protégée par l'action de l'utilisateur et par l'interrupteur des réglages.

## Permissions de la phase 4

| Permission | Niveau | Accordée par défaut | Utilisée par |
|---|---|---|---|
| `system.read` | automatic | oui | `system.processes` (processus actifs, lecture seule) |
| `file.read` | automatic | oui | `files.search` (recherche dans les dossiers utilisateur) |
| `file.write` | confirmation | oui (demande à chaque fois) | `files.operate` : renommer, déplacer, copier |
| `file.delete` | confirmation | oui (demande à chaque fois) | `files.operate` : envoi à la corbeille |
| `agent.run` | confirmation | oui (demande à chaque fois) | `agent.claude-code` |
| `window.read` | automatic | oui | `actions.window-control` : liste des fenêtres visibles (Windows) |
| `window.control` | confirmation | oui (demande à chaque fois) | `actions.window-control` : activer une fenêtre, demander sa fermeture (Windows) |
| `plugin.manage` | confirmation | oui (demande à chaque fois) | `actions.plugin-manager` : examiner, installer, supprimer un plugin de données |
| `connector.install` | confirmation | oui (demande à chaque fois, jamais mémorisée) | `mcp_install` : installer un connecteur MCP. Le courtier affiche la commande exacte (`npx -y paquet@version`), le dépôt et les noms des variables |
| `connector.call` | confirmation | oui (demande à chaque fois, jamais mémorisée) | `mcp_call` : chaque appel d'outil, avec sa classe et les arguments complets |
| `connector.scope` | confirmation | oui (demande à chaque fois, jamais mémorisée) | `mcp_set_scopes` : accorder l'écriture ou la suppression à un connecteur |

### Qui peut appeler quoi : une politique par commande, décidée côté natif

L'interface n'envoie plus d'identité. Auparavant, chaque commande recevait une chaîne `caller` fournie par le JavaScript :
n'importe quel script de la fenêtre pouvait alors se dire `core` ou un autre plugin. Ce n'est plus le cas.

Chaque commande native a une politique, dans la table `POLICIES` de `src-tauri/src/grants.rs` :

- `MainWindow` : seule la fenêtre `main` peut l'appeler (Tauri fournit le libellé de la fenêtre appelante). Toutes les
  commandes de l'interface sont dans cette catégorie, y compris les modèles, les captures, le réseau, le journal, les
  connecteurs MCP et l'état des permissions.
- `Capability(identité)` : la commande exerce une capacité de plugin. L'identité est une constante du natif, et les
  permissions sont celles du `plugin.json` correspondant.

| Identité native | Peut faire |
|---|---|
| `actions.process-list` | `system.read` uniquement |
| `actions.file-search` | `file.read` uniquement |
| `actions.file-operations` | `file.write`, `file.delete` (chacune confirmée) |
| `agents.claude-code` | `agent.run` (confirmé) |
| `actions.window-control` | `window.read`, `window.control` (confirmé) |
| `actions.plugin-manager` | `plugin.manage` (confirmé à chaque étape) |

Tests : chaque commande exposée figure dans `POLICIES` et inversement ; la table des permissions correspond aux
`plugin.json` ; la CSP interdit les scripts en ligne et l'évaluation de chaîne ; la capacité Tauri ne vise que `main`.

**Fenêtre de confirmation, séparée.** Les demandes de confirmation ne s'affichent que dans une seconde fenêtre, `confirm`
(`tauri.conf.json`, et sa capacité dans `capabilities/confirmation.json`). Seule cette fenêtre peut répondre
(`permission_answer`, `confirmation_pending`). L'interface principale reçoit seulement un avis : « une confirmation attend »,
sans paramètres ni boutons. Elle ne peut donc pas approuver sa propre demande. La fenêtre se cache au lieu de se fermer ;
une demande sans fenêtre de confirmation échoue, et l'action n'a pas lieu.

**Limites restantes.** Le JavaScript de la fenêtre principale peut déclencher des demandes, lire et révoquer les
autorisations mémorisées, et lire les réglages. Il ne peut ni approuver une demande, ni modifier ce qui est affiché dans la
fenêtre de confirmation. Cette fenêtre n'affiche que du texte (aucun HTML), et son JavaScript est celui de NEXUS.

Il n'existe plus de pont par plugin : chaque commande porte sa politique (voir ci-dessus). « Demandé par » affiche
l'identité native de la capacité appelée, par exemple `actions.file-operations`.

Un plugin ne peut pas approuver sa propre demande : seul `core` peut répondre à `permission_answer`.

### Limite de l'identité

L'identité est fournie par la fenêtre. Elle empêche un plugin de dépasser son manifeste lorsqu'il passe par le
pont de NEXUS. Elle **ne** protège **pas** contre du code hostile qui appellerait directement l'API Tauri de la
fenêtre : il pourrait se déclarer `core`. Aujourd'hui, les plugins sont compilés dans l'application et seul ce
code tourne dans la fenêtre. Avant de charger des plugins tiers, il faudra un isolement réel (processus séparé ou
fenêtre dédiée) et une identité que la fenêtre ne peut pas choisir.

### Confirmation native

- Le backend Rust, et non l'interface, exige la confirmation : `files_operate` puis `agent_run` appellent
  `permissions::confirm` avant toute action. Un appel direct à la commande, sans passer par l'interface, demande
  donc aussi la confirmation.
- Chaque demande affiche ses lignes (source, destination, dossier de projet, demande) et expire après 120 secondes.
  Une réponse absente, expirée ou inconnue vaut refus.
- Les opérations sont planifiées avant d'être appliquées : le plan (source, destination) est calculé, présenté,
  puis seulement exécuté. L'action appliquée est celle qui a été affichée. Il n'y a pas de contrôle d'identité du
  fichier entre l'affichage et l'exécution : un fichier modifié entre-temps reste soumis à la même opération.

### Limites des racines de fichiers

- Racines autorisées : sous-dossiers canoniques de Documents, Téléchargements, Bureau et Images. Le dossier
  personnel n'est jamais une racine ; une recherche ou une opération hors de ces racines est refusée
  (`outside-allowed-folders`). Les chemins relatifs sont refusés.
- La suppression passe par la corbeille. Aucune suppression définitive n'est proposée.
- Aucune élévation de privilèges, aucune commande shell construite à partir d'un texte.

### Claude Code

- Lancé sans `--dangerously-skip-permissions` : les demandes de permission de Claude Code restent actives.
  Un outil refusé apparaît dans la fiche de résultat.
- La demande est transmise sur l'entrée standard, jamais dans la ligne de commande.
- Budget plafonné à 0,50 $ par run ; délai de 15 minutes ; annulation possible à tout moment.

## Contrôle des fenêtres (Windows)

- Lister : permission automatique, lecture seule. Les fenêtres d'outils, sans titre, et celles de NEXUS sont exclues.
- Activer ou fermer : confirmation obligatoire, avec le titre et le processus de la fenêtre visés.
- Un nom qui correspond à plusieurs fenêtres n'entraîne aucune action : NEXUS demande de préciser.
- La fermeture envoie `WM_CLOSE`. L'application décide : elle peut refuser, ou demander d'enregistrer. NEXUS ne termine jamais un processus.
- NEXUS ne ferme jamais sa propre fenêtre.
- Identifiant de fenêtre revérifié juste avant chaque action : une fenêtre fermée entre-temps n'est pas remplacée par une autre.

## Plugins de données (phase 5)

- Installer un plugin demande **deux confirmations** : la première avant tout accès réseau (la source), la seconde avant
  l'installation (identifiant, version, commit, types, empreinte). La seconde porte sur l'empreinte affichée : un contenu
  modifié entre-temps est refusé.
- Supprimer un plugin demande une confirmation.
- Un plugin de données n'a aucune permission native : il ne peut que compléter le vocabulaire et les noms d'applications.
- Un plugin `action` (WebAssembly) ne reçoit que les permissions qu'il demande dans son manifeste, avec leur raison, et que l'utilisateur approuve à l'installation : `storage.local` (quota de 256 Ko au plus) et `network.fetch` (hôtes HTTPS déclarés, aucune redirection). Le natif applique le lock approuvé à chaque exécution, et refuse toute opération hors de ces permissions, même pour un module qui la demande.
- Supprimer un plugin supprime aussi ses données (stockage clé-valeur).
- Un plugin dont le contenu a changé après approbation n'est plus chargé. Son état apparaît dans « liste mes plugins ».
- Les paquets sont revérifiés à chaque commande.
- Seule l'interface lit les paquets actifs (`plugin_packs`).
- Git : HTTPS seulement, sans identifiants dans l'adresse, clonage superficiel, aucun script exécuté.

## Autorisations mémorisées (« toujours autoriser »)

Sur une demande de confirmation, une case « Toujours autoriser » couvre les actions répétitives. Elle n'apparaît que pour
les permissions qui peuvent être mémorisées, et seulement quand une portée est connue :

- **Écriture de fichier** (renommer, déplacer, copier) : la règle couvre le dossier de la demande, ses sous-dossiers
  compris. Une opération qui sort de ce dossier (par exemple un déplacement vers un autre dossier) n'est pas couverte et
  demande de nouveau l'accord.
- **Lancement de Claude Code** : la règle couvre un projet, identifié par son dossier exact.
- **Jamais mémorisables** : la suppression (corbeille), la fermeture d'une fenêtre, l'installation ou la suppression d'un
  plugin. Le natif refuse de créer une règle pour elles, même si la demande le réclame.
- Une réponse de refus ne crée jamais de règle, même avec la case cochée.
- Un chemin contenant `..` n'est jamais couvert, et un dossier voisin au nom commençant pareil (`Docs2` pour `Docs`)
  ne l'est pas.

Rien n'est silencieux :

- Chaque action approuvée par une règle est annoncée dans la conversation, avec la règle utilisée, et gardée dans un
  journal visible dans les réglages (20 entrées affichées, 200 gardées côté natif, en mémoire pour la session).
- Les règles sont stockées dans `permission_rules.json`, dans le dossier de données de l'application, et survivent au
  redémarrage. Elles se révoquent une à une dans les réglages ; la révocation prend effet immédiatement, et la
  prochaine demande de cette portée est de nouveau posée.
- Réservé à l'interface : un plugin ne peut ni créer, ni lire, ni révoquer une règle.

## Journal des commandes (phase 5)

- Désactivé par défaut. Aucune commande n'est conservée tant que l'option n'est pas activée dans les réglages.
- Conservé : le texte de la commande (300 caractères au plus) et son type reconnu. Jamais les résultats, ni le contenu des fichiers.
- 500 commandes au plus ; les plus anciennes sont supprimées. Le journal peut être vidé à tout moment.
- Stocké dans le dossier de données de l'application, sur cet ordinateur. Aucun envoi réseau.
- Réservé à l'interface : un plugin ne peut ni lire ni alimenter le journal.

## Accès réseau, téléchargements et écriture système

Ces fonctions sont ajoutées après la phase 4 (ADR-035 à ADR-044). Aucune n'agit sur les fichiers personnels ou sur le système sans l'accord de l'utilisateur.

| Fonction | Ce qui se passe | Accord |
|---|---|---|
| Questions ouvertes sur le web | Recherche DuckDuckGo (version HTML, sans clé), 3 pages au plus lues (HTTP ou HTTPS, 1 Mo chacune). Les adresses locales, privées, avec port ou identifiants sont refusées. Seuls les termes de la recherche sont envoyés. | Demande de l'utilisateur, sans confirmation supplémentaire |
| Actualités, photos, fiches | Hôtes fixes dans le natif : Google Actualités, Wikipédia fr, Wikimedia Commons. Les images sont téléchargées côté natif (3 Mo au plus). | Demande de l'utilisateur |
| Capture d'écran | Une seule capture de l'écran principal, en mémoire, jamais enregistrée. Elle est lue par un modèle de vision local et affichée à l'utilisateur. | « oui » demandé à chaque question |
| Agenda | Lecture seule d'un fichier `.ics` désigné dans les réglages (2 Mo au plus). | Choix du fichier dans les réglages |
| Messages | Un brouillon est affiché avec un bouton « Copier ». NEXUS n'envoie rien. | Aucun envoi possible |
| Voix neurale (Piper) | Téléchargement du moteur et de la voix française depuis des adresses fixes, avec somme SHA-256 vérifiée. | Clic sur « Installer » |
| Ollama et modèle de langage | Installation d'Ollama par `winget` et du modèle choisi. NEXUS ne parle qu'à `127.0.0.1:11434`. | Accord au premier lancement |
| NVIDIA NIM (option) | Désactivé par défaut. Avec une clé fournie par l'utilisateur, la demande part à `integrate.api.nvidia.com`, seul hôte autorisé ; le reste du contexte seulement si l'utilisateur l'a coché. La clé est chiffrée par Windows (DPAPI) et ne quitte pas le natif. | Activation, clé et cases dans les réglages |
| Démarrage avec Windows | Écrit la valeur `NEXUS` dans `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. Sans droits administrateur, jamais à l'installation. | Case cochée dans les réglages |

## Restant à faire

- Désactivation du microphone et de chaque module.
- Arrêt immédiat des opérations en cours (l'annulation existe déjà dans le moteur de tâches).
- Chiffrement des jetons des connecteurs MCP (`mcp/installed.json`) et de la clé NIM, aujourd'hui en clair.

## Connecteurs MCP

- **Installation** : seulement après accord du courtier natif (`connector.install`), qui montre le nom, le dépôt, la commande exacte (`npx -y paquet@version`) et le nom des variables. Un connecteur absent du registre officiel, ou sans assez d'étoiles, n'est jamais proposé.
- **Variables** : chiffrées par DPAPI, liées au compte Windows (`mcp/installed.json`). Le fichier ne contient plus leur texte ; un ancien fichier en clair est migré. L'interface ne les relit jamais.
- **Périmètre** : chaque outil est classé en *lecture*, *écriture* ou *suppression*. Le classement retient le plus risqué entre les annotations du serveur et le nom de l'outil ; la description n'entre jamais en compte. Un connecteur n'a que la lecture par défaut. Accorder l'écriture ou la suppression passe par le courtier (`connector.scope`, jamais mémorisé) ; il n'existe pas encore de réglage dans l'interface pour le faire.
- **Appel d'un outil** : dans l'ordre, NEXUS vérifie le nom (annoncé par le serveur), les arguments (schéma), puis le périmètre. Seulement après, le courtier demande l'accord (`connector.call`), avec la classe de l'outil, les arguments complets et la commande exacte. Un outil hors périmètre n'est jamais présenté.
- **Isolation sous Windows** : le connecteur tourne dans un *job object* : tous ses processus (cmd, node, enfants) s'arrêtent à la fin de la session, même si NEXUS plante ; au plus 64 processus, 2 Go de mémoire chacun. Son environnement est vidé : seules quelques variables système lui sont transmises, plus les siennes. Les variables de NEXUS et de l'utilisateur ne lui parviennent pas (testé avec un serveur simulé).
- **Délai** : 120 s par session, la confirmation non comprise ; un serveur muet est arrêté (testé).
- **Limites non couvertes** : aucune restriction réseau ni de fichiers pour le connecteur. Un job object ne restreint ni l'un ni l'autre ; une isolation plus forte (AppContainer, bac à sable Windows) reste une décision à prendre. Le job est attribué juste après le lancement : un enfant créé pendant cet instant échappe au job. L'intégrité du paquet est celle de npm ; NEXUS ne vérifie pas la provenance.
- **Serveur hostile** : un serveur peut mentir sur ses annotations ou écrire des consignes dans ses descriptions. Le nom de l'outil et le périmètre accordé l'emportent ; l'accord montre toujours les arguments exacts.

## Mémoire de l'utilisateur

- **Enregistrement** : le modèle local garde sans question les informations durables que l'utilisateur donne sur lui (prénom, ville, préférences). Aucune limite de nombre.
- **Première conversation** : sept questions après le setup, chacune passable ; les réponses deviennent des souvenirs.
- **Oubli** : « oublie X » supprime tout de suite les souvenirs qui contiennent X ; « oublie tout » demande une confirmation.
- **Envoi au modèle** : le modèle local reçoit les souvenirs, les éléments affichés et les commandes de plugins à chaque demande, en local (Ollama sur ce poste). NVIDIA ne reçoit que les catégories cochées (voir NVIDIA NIM).
- **Consultation, export et suppression** : liste dans les réglages, suppression par ligne, « Tout effacer », et export en JSON copiable (`memory_export`).
- **Effacement vérifié** : après une suppression, NEXUS relit le fichier `memory/memories.json` et refuse de confirmer si le texte supprimé y figure encore. Les blocs du disque peuvent rester lisibles par des outils de récupération tant que le disque n'est pas chiffré : BitLocker est recommandé.
- **Rétention** : les souvenirs restent jusqu'à suppression. Il n'existe pas d'expiration automatique. La conversation n'est pas conservée au redémarrage.
- **Journal des commandes** : désactivé par défaut ; quand il est activé, il ne garde que les 500 dernières commandes, en texte seulement.

## NVIDIA NIM : ce qui part

- **Toujours** : la demande, la date et l'heure, et la liste des commandes des plugins.
- **Sur case cochée seulement** : les derniers échanges de la conversation, les souvenirs, et ce qui est affiché (fichiers, pages, applications). Aucune case n'est cochée par défaut.
- **Local strict** : décocher « Utiliser NVIDIA NIM en premier » : rien ne quitte ce poste.
- Les catégories sont appliquées avant l'envoi, dans l'interface : le natif transmet ce qu'il reçoit. Un test vérifie que les souvenirs ne partent pas sans case cochée.
