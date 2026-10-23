# Architecture de NEXUS

NEXUS suit un principe : l'utilisateur formule une intention, le système choisit les outils.
La chaîne est déterministe par défaut. Un modèle de langage n'intervient que lorsqu'aucune
règle locale ne suffit (non implémenté en phase 1).

## Vue d'ensemble

```
┌──────────────────────── Application frontend (React + TypeScript) ────────────────────────┐
│ Orbe · zone des tâches · fenêtres flottantes · barre de commande · historique           │
│ src/ui/*  — ne contient aucune logique métier                                           │
└───────────────┬───────────────────────────────────────────▲───────────────────────────────┘
                │ commandes texte (phase 2 : voix)           │ événements (message, orbe,
                ▼                                           │ tâche, fenêtre à présenter)
┌──────────────────────── Core Engine (TypeScript pur, testable sans interface) ──────────┐
│ intent/      normalisation + classification déterministe FR/EN (zéro appel réseau)       │
│ engine/      routage : intention → capacité, orchestration, orbe, messages              │
│ capabilities/ registre : permissions, délais, annulation, isolation des erreurs          │
│ tasks/       file de tâches avec états réels (en attente, en cours, terminée, …)         │
│ presentation/ placement spatial des fenêtres, dimensionnement, historique                │
└───────────────┬───────────────────────────────────────────────────────────────────────────┘
                │ NativeAdapter (contrat typé, src/core/native/adapter.ts)
                ▼
┌──────────────────────── Windows Adapter (Rust, Tauri 2) — src-tauri/src ─────────────────┐
│ system.rs    informations système réelles (sysinfo)                                      │
│ apps.rs      catalogue FERMÉ d'applications, résolution des chemins, lancement           │
│ lib.rs       commandes Tauri exposées au frontend                                        │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

Règle de frontières : le frontend ne voit jamais de commande shell. Le core ne connaît que le
contrat `NativeAdapter`. Le backend Rust ne connaît que des identifiants du catalogue.

## Flux d'une commande

1. `CommandBar` envoie le texte à `Engine.submit`.
2. `parseIntent` normalise (accents, casse, mot d'activation) puis applique les expressions
   régulières des dictionnaires FR/EN. Résultat : une `Intent` typée, `resolvedBy: "rules"`.
3. Le routeur choisit la capacité (`apps.launch`, `system.info`) ou une action de contrôle
   (fermer une fenêtre, annuler des tâches, aide).
4. La capacité passe par `CapabilityRegistry.invoke` : permissions vérifiées, délai appliqué,
   annulation transmise, erreurs converties en `CapabilityError`.
5. Le `TaskManager` expose l'état réel de la tâche : `pending` tant que la file est saturée,
   `running` pendant l'appel natif, puis `done`, `error` ou `cancelled`.
6. Le résultat devient une réponse courte (sous l'orbe) et, si besoin, des `PresentedContent`.
7. Le moteur de placement choisit un emplacement libre pour chaque fenêtre.

## Pipeline vocal (phase 2)

```
Micro (cpal) ──► 16 kHz mono ──► Silero VAD (tract) ──► Segmenter ──► whisper.cpp (whisper-rs)
   src-tauri/src/voice/capture.rs      vad.rs              segmenter.rs        transcribe.rs
                                                              │
                                 événements `voice://event` ◄─┘ (session.rs)
                                                              ▼
Frontend : VoiceController ──► Engine.submit(texte, langue de réponse) ──► réponse
                 │                                                          │
                 └── lecture à voix haute (API Web Speech, voix système) ◄──┘
```

- Le micro n'est ouvert que pendant une session demandée (bouton, raccourci `Ctrl+Alt+Espace`).
- Le VAD découpe la parole. Whisper ne reçoit que des énoncés complets, avec 300 ms de silence avant le début.
- Les événements `listening`, `speech-started`, `transcribing`, `transcript`, `error`, `stopped` pilotent l'orbe et la barre de commande.
- `VoiceController` (`src/core/voice/controller.ts`) ne connaît ni Tauri ni le DOM. Ses dépendances (entrée, sortie, moteur) sont injectées ; les tests utilisent des doubles nommés.
- Langue : Whisper détecte la langue de la voix ; un comptage de mots fréquents sert au texte. Le réglage « automatique » répond dans la langue détectée, les réglages « français » ou « anglais » l'imposent.
- Le modèle de reconnaissance n'est jamais téléchargé automatiquement. Son emplacement est `<données applicatives>/models/ggml-base.bin`, ou la valeur de `NEXUS_WHISPER_MODEL`.

## Connecteurs OSINT et isolation (phase 3)

```
Frontend : osint.domain / osint.username / document.inspect (capacités, permissions, délais)
     │  invoke("osint_run", { request })
     ▼
Backend : osint_run ──► liste fermée CONNECTORS ──► spawn `nexus-worker` (processus séparé)
                                                        │ requête JSON sur stdin
                                                        ▼
                                          plugins::run_connector ──► sources (dns, certificates, usernames) | documents
                                                        │ rapport JSON sur stdout (4 Mo max)
     ◄──────────── rapport normalisé (findings, errors, partial) ◄──┘
Délai dépassé : le worker est arrêté (kill). Sortie invalide ou code d'erreur : erreur explicite.
```

- Le worker ne reçoit que la requête. Il n'a accès ni à l'état de l'application ni à l'interface.
- Chaque résultat garde sa source (nom, URL), sa date de collecte et un statut. Les sources ne sont jamais fusionnées :
  deux profils au même pseudo restent deux résultats distincts, sans attribution.
- Les limites de lecture (un 404 n'est pas une absence) sont affichées avec les résultats.

## Niveaux de compréhension et de coût

| Niveau | Mécanisme | Phase | État |
|---|---|---|---|
| 1 | Expressions régulières, dictionnaires d'alias, priorités explicites | 1 | Implémenté |
| 2 | Classification locale légère (spaCy, embeddings) | 5 | Non commencé |
| 3 | Petit modèle local via Ollama | 5 | Non commencé |
| 4 | Fournisseur externe optionnel, choisi par l'utilisateur | 5 | Non commencé |

Coût des capacités (champ `cost` du manifeste) : `local`, `internet`, `external-api`, `llm`.

## Capacités et plugins

La convention complète (dossiers par type, fiche `plugin.json`, cycle de vie) est dans [PLUGINS.md](PLUGINS.md).

Chaque capacité déclare un `CapabilityManifest` : identifiant (`domaine.action`), version
sémantique, description, catégories, entrées et sorties, dépendances, permissions requises,
localité (`local` ou `network`), API requises, délai maximal, coût, disponibilité hors ligne.

Les entrées sont sérialisables (`Record<string, string>`) : c'est la frontière qui permettra,
en phase 3, de déplacer les plugins dans des processus isolés sans changer leur contrat.

En phase 1, les capacités intégrées (désormais dans `plugins/`) s'exécutent dans le
processus de l'application. Le registre garantit déjà qu'une erreur ou un dépassement de délai
ne fait pas tomber l'application.

## Placement spatial des fenêtres

`src/core/presentation/placement.ts` est une fonction pure :

- Zones interdites : marges d'écran, zones HUD (`[data-hud]`), cercle d'exclusion de l'orbe
  (rayon de l'orbe + espace), fenêtres existantes (avec espacement).
- Candidats : grille de points sur l'écran, essai en taille complète puis réduite (85 %, 70 %).
- Score : distance à un anneau autour de l'orbe, et éloignement des autres fenêtres pour ne pas
  les empiler au même endroit. Le meilleur score gagne.
- Si l'écran est saturé, la fenêtre la plus ancienne est déplacée dans l'historique
  (`evicted`) pour laisser place au résultat le plus récent.
- Au redimensionnement, `reflowWindows` conserve les fenêtres encore valides et replace les autres.

Le DOM n'est lu que par `src/ui/scene.ts`. Le moteur reste testable sans navigateur.

## Données et état

- Phase 1 : état en mémoire (transcription, tâches, fenêtres, historique borné à 20 entrées).
- Préférence de langue : `localStorage`, avec repli si le stockage est indisponible.
- SQLite est prévu pour l'historique persistant (phase 5). Aucune donnée personnelle n'est écrite
  sur disque en phase 1.

## Multilinguisme

- Interface : `src/i18n/messages.ts`. Le TypeScript impose la parité des clés FR et EN.
- Commandes : les dictionnaires de `src/core/intent/dictionaries.ts` s'appliquent à toutes les
  langues chargées, quelle que soit la langue de l'interface.
- Ajouter une langue : un dictionnaire d'intentions, un jeu de messages, et les formats `Intl`.

## Ce que la phase 1 n'implémente pas

- Plugins externes chargés à chaud (phase 5), recherche de fichiers et contrôle des fenêtres
  Windows (phase 4), corrélation et LLM (phase 5).
- Icône de zone de notification, démarrage automatique, wake word : non encore livrés.
- Traduction (Argos), reconnaissance de commandes courtes par modèle dédié : phases suivantes.
- Analyse d'adresses email, enregistrements MX/TXT/NS, métadonnées EXIF : prévus, non livrés.
- Le lancement réel n'a été vérifié que sur Linux (voir `docs/PLAN.md`) ; le comportement
  Windows reste à valider sur une machine Windows.
