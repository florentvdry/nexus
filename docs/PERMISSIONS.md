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

### Limite à traiter avant les plugins tiers

Aujourd'hui, tous les plugins sont compilés dans l'application et partagent le même contexte. Le registre
TypeScript est la seule barrière qui décide quelles capacités un plugin peut appeler. Les commandes natives
protègent les actions dangereuses (confirmation, racines), mais ne savent pas encore quel plugin les appelle.
Avant tout chargement de plugin depuis le disque, il faudra une identité de plugin vérifiée côté natif et
une permission par plugin contrôlée dans le backend.

## Prévu pour les phases suivantes

- Journal local des actions, consultable et supprimable.
- Révocation d'une permission depuis l'interface.
- Identité de plugin côté natif (voir ci-dessus).
- Désactivation du microphone et de chaque module.
- Arrêt immédiat des opérations en cours (l'annulation existe déjà dans le moteur de tâches).
