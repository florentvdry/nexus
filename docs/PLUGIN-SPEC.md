# Spécification des plugins NEXUS — schéma 1

Statut : **version 1 implémentée** pour les paquets de données (`language`, `aliases`). Les plugins avec code
(`action`, `source`, `document`, `agent`, `speech`) sont **réservés** : ils attendent la décision de bac à sable
décrite à la fin de ce document.

## 1. Principes

- **Local d'abord.** Un plugin est un dossier. Il est installé sur cet ordinateur, rien n'est envoyé à un serveur.
- **Données avant code.** Un paquet de données ne contient ni script ni expression régulière écrite par son auteur :
  seulement des listes de mots et des noms d'applications du catalogue.
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
| `kinds` | oui | liste non vide, sans doublon. Valeurs acceptées en schéma 1 : `language`, `aliases`. |
| `entryPoints` | oui | exactement un fichier JSON par type de `kinds`. |
| `permissions` | oui | **vide** en schéma 1 (voir § 9). |

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

`action`, `source`, `document`, `agent`, `speech` sont refusés avec le message « indisponible ». Ils attendent le
bac à sable (§ 10).

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

Pour l'instant, il n'existe pas de catalogue public. Le format de la marketplace est donc défini ici, pas hérité
d'un service externe.

## 8. Validateur

```
nexus-plugin validate <dossier>   # 0 si valide, 1 sinon, messages actionnables
nexus-plugin digest <dossier>     # l'empreinte que l'application affichera
```

Le job CI Windows exécute `validate` sur `examples/plugins/community.exemple.verbes`.

## 9. Permissions

En schéma 1, `permissions` doit être vide : un paquet de données n'a besoin d'aucune capacité native.
Le champ est réservé pour la suite, où chaque permission sera déclarée avec sa raison et soumise à l'accord
de l'utilisateur, comme pour les plugins intégrés (voir `docs/PERMISSIONS.md`).

## 10. Plugins avec code : décision à prendre

Le code d'un plugin ne sera pas exécuté dans la fenêtre principale tant qu'un isolement réel n'existe pas. Options :

- **WebAssembly (wasmtime), recommandé.** Le plugin ne voit que les fonctions hôte que son manifeste autorise ; les
  permissions sont vérifiées côté Rust, comme `grants.rs` aujourd'hui.
- **JavaScript dans une iframe sans `allow-same-origin`**, avec échange de messages validé. Plus simple, garantie plus
  faible, comportement de WebView2 et WebKitGTK à vérifier sous Windows.

Tant que ce choix n'est pas fait, les types avec code restent refusés.

## 11. Hors périmètre (schéma 1)

- Signature cryptographique des auteurs (l'empreinte garantit l'approbation, pas l'identité de l'auteur).
- Mise à jour automatique : toute mise à jour demande une nouvelle approbation.
- Métriques sociales (étoiles, installations) : elles supposent un serveur.
- Rechargement à chaud des fichiers : le plugin est revérifié à chaque commande, mais sa compréhension n'est mise
  à jour qu'à chaque commande.
