# Spécification des plugins NEXUS — schéma 1

Statut : **version 1 implémentée**. Deux familles : les **paquets de données** (`language`, `aliases`) et les
**plugins WebAssembly** (`action`), écrits dans n'importe quel langage qui compile vers WebAssembly (Rust au premier
rang, avec un SDK). Les types `source`, `document`, `agent` et `speech` restent réservés.

## 1. Principes

- **Local d'abord.** Un plugin est un dossier. Il est installé sur cet ordinateur, rien n'est envoyé à un serveur.
- **Données avant code.** Un paquet de données ne contient ni script ni expression régulière écrite par son auteur :
  seulement des listes de mots et des noms d'applications du catalogue.
- **Code dans un bac à sable.** Un plugin avec code est un module WebAssembly. Il ne peut agir qu'à travers une seule
  fonction hôte, et chaque action est vérifiée contre les permissions que l'utilisateur a approuvées (§ 4.4).
- **Rien n'est exécuté à l'installation.** Un dépôt Git est cloné sans hook ni script. Le contenu est seulement lu.
- **Ce que l'utilisateur approuve est exactement ce qui est installé.** L'approbation porte sur une empreinte SHA-256
  de tous les fichiers. Toute modification ultérieure désactive le plugin.
- **Un seul validateur.** Le même code contrôle un plugin dans l'application, dans `nexus-plugin validate` et en CI.

## 2. Dossier d'un plugin

```
community.ana.verbes/
├── nexus.json        manifeste (obligatoire)
├── language.json     un fichier par type déclaré dans entryPoints
├── aliases.json
└── README.md         facultatif
```

Règles :
- les dossiers `.git` et `target` **à la racine** sont ignorés : ils ne sont ni copiés, ni validés, ni inclus dans l'empreinte ;
- chemins relatifs, séparateur `/`, sans `..`, sans `.`, sans lecteur Windows ;
- **aucun lien symbolique**, aucun fichier spécial ;
- 300 fichiers au maximum, 2 Mo au total ;
- `nexus.json` : 64 Ko au maximum ; chaque fichier de type : 512 Ko au maximum.

## 3. Manifeste `nexus.json`

| Champ | Obligatoire | Règle |
|---|---|---|
| `schemaVersion` | oui | `1` |
| `id` | oui | `community.<auteur>.<nom>`, segments en minuscules, chiffres et tirets, 1 à 40 caractères, sans tiret au début ou à la fin. Le préfixe `nexus` est réservé. |
| `name` | oui | 1 à 80 caractères |
| `version` | oui | `x.y.z`, chiffres uniquement |
| `author` | oui | 1 à 80 caractères |
| `license` | non | texte libre, 40 caractères au plus |
| `description` | oui | 1 à 300 caractères |
| `engines.nexus` | oui | plage de versions, p. ex. `>=0.3.0 <1.0.0`. Si la version installée n'y est pas, le plugin est « invalide ». |
| `kinds` | oui | liste non vide, sans doublon. Valeurs acceptées : `language`, `aliases`, `action`. |
| `entryPoints` | oui | exactement un fichier par type de `kinds` : `.json` pour `language` et `aliases`, `.wasm` pour `action`. |
| `permissions` | non | liste de permissions (§ 9). **Réservée aux plugins `action`** : vide pour un paquet de données. |
| `commands` | non | commandes exposées par un plugin `action` (§ 4.4). Obligatoires pour `action`, interdites ailleurs. |

Champ inconnu = manifeste refusé : une faute de frappe ne passe jamais inaperçue.

Exemple : voir `examples/plugins/community.exemple.verbes/nexus.json`.

## 4. Types

### 4.1 `language` — vocabulaire supplémentaire

```json
{
  "locale": "fr",
  "phrases": {
    "openVerbs": ["allume", "mets en route"],
    "help": ["a l aide"]
  },
  "fillers": ["le", "la"]
}
```

- `locale` : deux lettres minuscules.
- `phrases` : clés acceptées : `openVerbs`, `closeAll`, `closeWindow`, `cancelTasks`, `systemInfo`, `help`.
  100 expressions au maximum par clé.
- `fillers` : mots retirés des noms d'application (« le », « la »). 50 au maximum, un mot chacun.
- Une expression : **lettres minuscules sans accent, chiffres, espaces simples**, 40 caractères au plus, 6 mots au plus.
- Le paquet doit contenir au moins une expression ou un mot de remplissage.
- Un paquet **complète** le vocabulaire intégré. Il ne le remplace jamais.

### 4.2 `aliases` — noms alternatifs d'applications

```json
{
  "applications": [
    { "id": "discord", "aliases": ["dis cord", "discorde"] }
  ]
}
```

- `id` : doit exister dans le catalogue d'applications de NEXUS. Un identifiant inconnu fait refuser le paquet.
- 50 applications au maximum, 20 alias par application, mêmes règles d'écriture que les expressions.
- Un alias ne peut ni lancer une commande ni ajouter une application : il ne fait que désigner une application connue.

### 4.3 Types réservés

`source`, `document`, `agent` et `speech` sont refusés avec le message « indisponible dans cette version ». Ils
touchent des données sensibles (fichiers, micro, connecteurs réseau) : leur accès passera par les mêmes permissions
que les plugins `action`, une fois celles-ci éprouvées.

### 4.4 Type `action` : plugin WebAssembly

Un plugin `action` est un module WebAssembly (`plugin.wasm`, 2 Mo au maximum), compilé pour `wasm32-unknown-unknown`
ou tout autre cible WebAssembly. Le module est exécuté dans un bac à sable : il ne voit ni le système de fichiers, ni le
réseau, ni l'application, sauf par les fonctions hôte ci-dessous.

**Interface attendue.** Le module doit :
- importer uniquement `nexus.host_call` (deux entiers : pointeur et longueur, retour : entier 64 bits) ;
- exporter `memory`, `nexus_alloc(longueur) -> pointeur` et `nexus_handle(pointeur, longueur) -> entier 64 bits`.

`nexus_handle` reçoit un message JSON `{"command": "<nom>", "input": {"text": "…"}}` et renvoie, en entier 64 bits
(pointeur à 32 bits en poids fort, longueur à 32 bits en poids faible), une réponse JSON
`{"caption": "…", "table": {"title", "columns", "rows"}}` (`table` facultatif).

**Fonctions hôte.** Chaque opération est un message JSON `{"op": "…", "args": {…}}` ; la réponse contient `ok`.

| Opération | Permission | Effet |
|---|---|---|
| `log` | aucune | journal de diagnostic (50 lignes, 200 caractères chacune). Jamais affiché à l'utilisateur. |
| `storage.get` / `storage.set` | `storage.local` | valeurs de 64 Ko au maximum, dans le dossier du plugin, quota respecté. |
| `fetch` | `network.fetch` | requête HTTPS GET vers un hôte déclaré. Aucune redirection. Réponse de 64 Ko au maximum. |

**Limites d'exécution.** 32 Mo de mémoire, 10 secondes par appel, 256 Ko par message dans chaque sens. Un module qui
dépasse le délai est interrompu.

**Commandes.** `commands` déclare, pour chaque commande : un nom (minuscules, chiffres, tirets), de 1 à 5
déclencheurs (expressions de § 4.1, uniques dans tout le catalogue installé) et une description de 200 caractères au
plus. Quand une commande est saisie, NEXUS prend le texte qui suit le plus long déclencheur (« convertis 12 km en
miles » → `convertit`, texte « 12 km en miles »).

**Réponses.** Une légende de 500 caractères au plus. Un tableau de 8 colonnes et 50 lignes au plus, cellules de 200
caractères. Une réponse hors bornes est refusée, jamais tronquée en silence.

**SDK Rust.** Le dossier `sdk/nexus-plugin-sdk` fournit les types, les fonctions hôte et la macro `export_commands!`.
L'exemple `examples/plugins/community.exemple.convertisseur` montre un plugin complet.

**Projet Rust.** Un plugin en Rust est un projet `cdylib` pour `wasm32-unknown-unknown`, qui utilise le SDK
`nexus-plugin-sdk`. NEXUS utilise wasmtime 50 : il accepte les encodages produits par les versions récentes de Rust.

## 5. Installation

Sources acceptées :
- une **adresse HTTPS de dépôt Git**, sans identifiants dans l'adresse (`https://utilisateur:secret@…` est refusé) ;
- un **dossier local absolu** (utile pour développer un plugin).

Étapes, dans l'ordre :

1. **Examen.** La source est lue dans un dossier de transit (`.staging/`). Pour Git : clonage superficiel
   (`--depth 1`), sans invite d'identifiants, délai de 120 secondes, puis suppression du dossier `.git`.
   Le commit est noté. **Première confirmation** : la source est affichée avant tout accès réseau.
2. **Validation.** Toutes les règles des §§ 2 à 4 sont contrôlées. Un problème arrête tout, le transit est supprimé.
3. **Approbation.** **Seconde confirmation** : identifiant, nom, version, source, commit, types, empreinte, et version
   actuelle si c'est une mise à jour.
4. **Installation.** Le natif recalcule l'empreinte et refuse si elle diffère de celle approuvée. Le dossier est
   déplacé dans `plugins/<identifiant>/`. Le lock est mis à jour.

Une mise à jour est une nouvelle installation avec une nouvelle approbation : la version précédente est remplacée.

### Empreinte

`sha256:` suivi de l'empreinte SHA-256 de la suite, pour chaque fichier trié par chemin :
`longueur_du_chemin (8 octets, big-endian)` · `chemin (UTF-8)` · `longueur_du_contenu (8 octets)` · `contenu`.

## 6. Lock et états

`plugins.lock.json`, dans le dossier de données de l'application :

```json
{ "plugins": { "community.ana.verbes": {
  "version": "1.0.0", "source": "https://…", "commit": "3f2a…", "digest": "sha256:…", "approvedAt": 1792764072 } } }
```

États, recalculés à chaque commande :

| État | Signification | Chargé ? |
|---|---|---|
| `active` | empreinte conforme, manifeste valide | oui |
| `modified` | le contenu a changé depuis l'approbation | non |
| `invalid` | un contrôle échoue (p. ex. version de Nexus incompatible) | non |
| `missing` | le dossier a disparu | non |

Seuls les plugins `active` influencent la compréhension des commandes.

## 7. Catalogue

Un fichier `index.json` que l'utilisateur désigne par la variable `NEXUS_PLUGIN_INDEX` (adresse HTTPS). Sans elle, aucun
catalogue n'est proposé.

```json
{ "schemaVersion": 1, "plugins": [
  { "id": "community.ana.verbes", "name": "Verbes", "version": "1.0.0", "description": "…",
    "source": "https://…/verbes.git", "kinds": ["language"] } ] }
```

- Le catalogue **indique** où trouver un plugin. Il ne contient ni code ni binaire.
- 500 entrées au maximum, identifiants uniques, sources HTTPS, types de la version 1 seulement.
- Installer par identifiant passe par le même chemin qu'une adresse : examen, puis deux confirmations.
- Un plugin `action` affiche ses permissions et ses commandes dans la seconde confirmation.

Pour l'instant, il n'existe pas de catalogue public. Le format de la marketplace est donc défini ici, pas hérité
d'un service externe.

## 8. Validateur

```
nexus-plugin validate <dossier>   # 0 si valide, 1 sinon, messages actionnables
nexus-plugin digest <dossier>     # l'empreinte que l'application affichera
```

Le job CI Windows exécute `validate` sur `examples/plugins/community.exemple.verbes`.

## 9. Permissions

Seules deux permissions sont accordables à un plugin `action`. Chacune doit porter une raison, en clair, affichée à
l'installation :

| Permission | Paramètres | Règle |
|---|---|---|
| `storage.local` | `quotaKb` : 1 à 256 | Stockage clé-valeur propre au plugin, supprimé avec lui. |
| `network.fetch` | `hosts` : 1 à 10 noms de domaine | Hôtes HTTPS seulement, en minuscules, sans joker ni port. |

L'utilisateur voit les permissions avec leurs raisons avant d'installer, et l'installation est approuvée avec elles.
Le natif ne retient que ces permissions approuvées : une permission ajoutée par une mise à jour demande une nouvelle
approbation. Une permission non déclarée est refusée à l'exécution, même par un module qui la demande.

## 10. Décision : WebAssembly

Les plugins avec code s'exécutent dans un bac à sable WebAssembly (wasmtime), pas dans la fenêtre principale. Motifs :

- Un plugin Rust reste possible : Rust compile vers WebAssembly. Le choix porte sur le **bac à sable**, pas sur le langage.
- Le module n'a qu'une fonction hôte. Chaque action est vérifiée côté Rust, sans dépendre du système d'exploitation.
- Les solutions de remplacement ont été écartées : une DLL Rust chargée dans NEXUS aurait les droits de l'application ;
  un processus séparé n'a pas de contrôle fin des permissions sans bac à sable système, complexe sous Windows.

Le JavaScript dans une iframe reste une option pour un public de développeurs web, avec une garantie plus faible.

## 11. Hors périmètre (schéma 1)

- Permissions au-delà de `storage.local` et `network.fetch` (fichiers, processus, micro) : elles viendront avec les types réservés.
- Signature cryptographique des auteurs (l'empreinte garantit l'approbation, pas l'identité de l'auteur).
- Mise à jour automatique : toute mise à jour demande une nouvelle approbation.
- Métriques sociales (étoiles, installations) : elles supposent un serveur.
- Rechargement à chaud des fichiers : le plugin est revérifié à chaque commande, mais sa compréhension n'est mise
  à jour qu'à chaque commande.
