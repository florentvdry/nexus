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

- Le lancement d'application n'accepte que des identifiants du catalogue Rust
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

### Qui peut appeler quoi : l'identité de l'appelant

Chaque commande native reçoit l'identifiant de son appelant : `core` pour l'interface, `type.dossier` pour un
plugin (par exemple `actions.file-search`). Le backend vérifie la permission correspondante avant toute action,
d'après la table `src-tauri/src/grants.rs`. Un test compare cette table aux `plugin.json` : une permission
déclarée sans être accordée, ou accordée sans être déclarée, fait échouer la compilation des tests.

| Appelant | Peut faire |
|---|---|
| `actions.process-list` | `system.read` uniquement |
| `actions.file-search` | `file.read` uniquement |
| `actions.file-operations` | `file.write`, `file.delete` (chacune confirmée) |
| `agents.claude-code` | `agent.run` (confirmé) |
| `actions.window-control` | `window.read`, `window.control` (confirmé) |
| `actions.plugin-manager` | `plugin.manage` (confirmé à chaque étape) |
| `core` (interface) | répondre aux confirmations, gérer le journal. Rien d'autre. |

Chaque plugin ne reçoit qu'un pont attribué à son identifiant : il ne peut pas agir au nom d'un autre plugin
en passant par ce pont. Une confirmation affiche « Demandé par » avec l'identifiant de l'appelant.

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

## Journal des commandes (phase 5)

- Désactivé par défaut. Aucune commande n'est conservée tant que l'option n'est pas activée dans les réglages.
- Conservé : le texte de la commande (300 caractères au plus) et son type reconnu. Jamais les résultats, ni le contenu des fichiers.
- 500 commandes au plus ; les plus anciennes sont supprimées. Le journal peut être vidé à tout moment.
- Stocké dans le dossier de données de l'application, sur cet ordinateur. Aucun envoi réseau.
- Réservé à l'interface : un plugin ne peut ni lire ni alimenter le journal.

## Prévu pour les phases suivantes

- Journal local des actions, consultable et supprimable.
- Révocation d'une permission depuis l'interface.
- Identité de plugin côté natif (voir ci-dessus).
- Désactivation du microphone et de chaque module.
- Arrêt immédiat des opérations en cours (l'annulation existe déjà dans le moteur de tâches).
