# Plugins

NEXUS est organisé en **plugins**. Chaque plugin est un dossier, rangé dans le dossier de son **type** :

```
plugins/                              ← code TypeScript et manifestes (un dossier par plugin)
  actions/system-info/                ← lecture des ressources de la machine
  actions/app-launch/                 ← lancement d'applications + catalogue d'alias
  sources/domain-analysis/            ← OSINT : DNS et certificats publics
  sources/username-search/            ← OSINT : présence d'un pseudo
  documents/file-inspect/             ← analyse locale d'un fichier désigné
  speech/whisper-stt/                 ← micro, VAD et transcription locale
  speech/system-tts/                  ← synthèse vocale système
  languages/fr/                       ← vocabulaire français
  languages/en/                       ← vocabulaire anglais

src-tauri/src/plugins/<type>/         ← code natif Rust du même type (connecteurs, Windows, voix)
```

Chaque dossier de plugin contient :

- `plugin.json` : sa fiche. Elle décrit ce que le plugin contribue, ce qu'il demande et ce qu'il coûte.
- `index.ts` : son point d'entrée. Il exporte `activate(api)` et n'enregistre que ce que la fiche déclare.

## Types

| Type | Contribue | Exemple |
|---|---|---|
| `actions` | capacités sur la machine, et éventuellement un catalogue d'applications | `system-info`, `app-launch`, `process-list`, `file-search`, `file-operations`, `window-control` |
| `sources` | connecteurs de données passifs, exécutés dans le worker isolé | `domain-analysis` |
| `documents` | analyse locale de fichiers désignés explicitement | `file-inspect` |
| `speech` | moteurs vocaux (entrée, sortie) | `whisper-stt`, `system-tts` |
| `languages` | vocabulaire et expressions pour comprendre les commandes | `fr`, `en` |
| `agents` | agents externes qui travaillent dans un projet, sous confirmation | `claude-code` |

Un plugin **WebAssembly** (`action`) est un module compilé, exécuté dans un bac à sable. Il déclare ses commandes et les
permissions qu'il demande ; ses commandes sont déclenchées par des expressions (« convertis 12 km en miles »). Il s'écrit
en Rust avec le SDK `sdk/nexus-plugin-sdk`, ou dans tout langage qui compile vers WebAssembly. Exemple complet :
`examples/plugins/community.exemple.convertisseur` (conversions d'unités et mémo). Spécification : [PLUGIN-SPEC.md](PLUGIN-SPEC.md), § 4.4.

Un **paquet de données** est un plugin installé par l'utilisateur, sans code : `language` (vocabulaire) et `aliases`
(noms d'applications). Il est décrit par `nexus.json` et validé par `nexus-plugin validate`. La spécification complète
est dans [PLUGIN-SPEC.md](PLUGIN-SPEC.md). Exemple : `examples/plugins/community.exemple.verbes`.

## La fiche `plugin.json`

| Champ | Rôle |
|---|---|
| `id` | `<type>.<dossier>`, obligatoire. Vérifié contre le chemin. |
| `type` | Doit correspondre au dossier parent. |
| `apiVersion` | Version de l'API de plugins visée. Actuellement `1`. Une autre version est refusée. |
| `version` | Version sémantique du plugin. |
| `entry` | Point d'entrée TypeScript (`index.ts`). |
| `native` | Modules Rust associés, p. ex. `sources::dns`. |
| `capabilities` | Identifiants des capacités enregistrées. Tout autre enregistrement est refusé. |
| `connectors` | Connecteurs exécutés dans le worker. Doit correspondre exactement à la liste Rust (testé). |
| `languages` | Codes de langue enregistrés. |
| `applications` | `true` si le plugin fournit le catalogue d'applications. |
| `permissions` | Permissions demandées (voir `docs/PERMISSIONS.md`). Une permission inconnue est refusée. |
| `locality`, `cost`, `offline` | Localité (`local` ou `network`), coût (`local`, `internet`, `external-api`, `llm`), disponibilité hors ligne. |

## Cycle de vie

1. **Découverte** : chaque `plugins/<type>/<nom>/plugin.json` est lu. Un dossier sans `index.ts` est signalé.
2. **Validation** : type, identifiant, API, version et permissions sont vérifiés.
3. **Activation** : `activate(api)` est appelé. L'API refuse tout enregistrement non déclaré dans la fiche.
4. **Isolation** : une erreur à l'une de ces étapes désactive ce seul plugin. Le moteur reste utilisable, et
   `engine.plugins` indique l'état et la raison de chaque plugin.

Le côté natif suit la même logique : `plugins::report` définit le modèle commun, et un test vérifie que la liste
des connecteurs Rust (`plugins::CONNECTORS`) correspond exactement aux fiches `sources` et `documents`.

## Créer un plugin

1. Créer `plugins/<type>/<nom>/` avec un `plugin.json` et un `index.ts`.
2. Déclarer ce qui est enregistré dans la fiche, puis écrire `activate(api)` qui enregistre la capacité.
3. Si le plugin a du code natif, l'ajouter dans `src-tauri/src/plugins/<type>/` et le déclarer dans `native`.
   Pour un connecteur, l'ajouter aussi dans `plugins::CONNECTORS` et `plugins::run_connector`.
4. Ajouter des tests : au minimum, le plugin s'active (`src/core/plugins/plugins.test.ts`) et son comportement.

Les simulations de source (serveurs locaux, runners factices) sont réservées aux tests et doivent être étiquetées comme telles.

## Permissions et appels natifs

Un plugin déclare ses permissions dans `plugin.json`. Ses appels natifs passent par un pont attribué à son
identifiant : le natif n'accorde que les permissions de ce manifeste (`src-tauri/src/grants.rs`). Un test vérifie que
la table native et les `plugin.json` restent identiques. Un plugin qui demande une permission non accordée reçoit
une erreur `permission-refused`, pas un accès silencieux.

## Ce qui n'est pas encore fait

- **Plugins d'exécution plus larges** : les plugins WebAssembly n'ont accès qu'au stockage et au réseau déclaré. Les accès
  aux fichiers, aux processus et au micro passeront par des permissions supplémentaires, une fois éprouvées.
- **Bibliothèque publique de plugins** : le catalogue est défini, mais aucun dépôt public n'existe encore.
- **Plugins de synthèse et de reconnaissance** : ce sont des plugins `speech` fixes, utilisés directement par l'interface.
  Ils ne passent pas encore par l'hôte. Ils le feront quand un second moteur vocal existera.
- **Empaquetage du worker** : il doit être déclaré comme binaire externe avant tout installateur.

## Vers une marketplace

L'idée : installer un plugin depuis un catalogue, comme un paquet, avec sa fiche affichée avant l'installation.
Cette fonctionnalité n'existe pas encore. Avant d'ouvrir l'installation à des tiers, il faut traiter les points suivants.

1. **Les plugins TypeScript ont accès à l'API Tauri.** Un plugin tiers pourrait appeler n'importe quelle commande
   native. Avant toute ouverture : les appels natifs doivent être filtrés par les permissions déclarées par le plugin.
2. **Le code natif Rust est compilé dans l'application.** Un plugin natif tiers exigerait une signature et une
   revue, ou un passage par un mécanisme isolé (WebAssembly, ou processus worker avec permissions restreintes).
3. **Authenticité** : signature des paquets, empreinte publiée, mise à jour contrôlée. Le champ `apiVersion`
   prépare la compatibilité, mais aucune vérification de signature n'est implémentée.
4. **Consentement** : à l'installation, les permissions demandées sont affichées. Une permission `restricted` n'est
   jamais accordée automatiquement.
5. **Emplacement** : les plugins installés par l'utilisateur seraient dans `%APPDATA%\fr.nexus.assistant\plugins\`,
   séparés des plugins livrés. Un plugin installé ne peut pas remplacer un plugin livré.
6. **Désinstallation** : suppression complète, sans données résiduelles hors de son dossier.

Le catalogue d'Omarchy (plugins.omarchy.org) n'a pas pu être consulté depuis l'environnement de développement :
son fonctionnement n'est donc pas pris en compte ici. L'organisation proposée reprend seulement l'idée d'un dossier
par plugin et d'une fiche lisible.
